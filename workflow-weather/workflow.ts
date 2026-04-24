/**
 * CRE Workflow: Weather
 *
 * Flow:
 *   1. EVM Log Trigger on WeatherCRE.WeatherRequested(city, requester)
 *   2. HTTP GET https://wttr.in/{city}?format=3&m     (plain-text weather line)
 *   3. EVM writeReport → WeatherCRE.onReport(report)
 *        report = abi.encode(string city, string temperature, uint256 timestamp, address sender)
 */
import {
  cre,
  getNetwork,
  type Runtime,
  EVMClient,
  TxStatus,
  HTTPClient,
  hexToBase64,
  bytesToHex,
} from '@chainlink/cre-sdk'
import {
  type Address,
  parseAbi,
  parseAbiParameters,
  encodeAbiParameters,
  decodeEventLog,
  hexToBytes,
  keccak256,
  toBytes,
} from 'viem'
import { z } from 'zod'

// ─── Config ────────────────────────────────────────────────────────────────
export const configSchema = z.object({
  chainSelectorName: z.string(),
  weatherCREAddress: z.string(),
  gasLimit: z.number(),
})
type Config = z.infer<typeof configSchema>

// ─── EVM Client (module-level, initialized in initWorkflow) ────────────────
let network: ReturnType<typeof getNetwork>
let evmClient: EVMClient

// WeatherRequested(string city, address requester)
const WEATHER_REQUESTED_ABI = parseAbi([
  'event WeatherRequested(string city, address requester)',
])
const WEATHER_REQUESTED_SIGNATURE = 'WeatherRequested(string,address)'

// ─── Handler ───────────────────────────────────────────────────────────────

export function onWeatherRequested(runtime: Runtime<Config>, log: any): string {
  runtime.log('EVM Log: WeatherRequested emitted')
  runtime.log(`Block: ${log.blockNumber}, TxHash: ${log.txHash}`)

  // Decode (city, requester) from the event log
  const decoded = decodeEventLog({
    abi: WEATHER_REQUESTED_ABI,
    data: log.data,
    topics: log.topics,
  })
  const city = decoded.args.city as string
  const requester = decoded.args.requester as Address
  runtime.log(`City: ${city}, Requester: ${requester}`)

  // ── HTTP GET: wttr.in ────────────────────────────────────────────────
  runtime.log(`Fetching weather for ${city}`)
  const httpClient = new HTTPClient()
  const temperature = httpClient
    .sendRequest(
      runtime,
      (sendRequester) => {
        const res = sendRequester
          .sendRequest({
            method: 'GET',
            url: `https://wttr.in/${encodeURIComponent(city)}?format=3&m`,
          })
          .result()
        if (res.statusCode !== 200) throw new Error(`HTTP GET failed: ${res.statusCode}`)
        return Buffer.from(res.body).toString('utf-8').trim()
      },
      // wttr.in is public and deterministic enough for a simple consensus
      (a: string) => a,
    )(runtime.config)
    .result()

  runtime.log(`Weather: ${temperature}`)

  // ── EVM WRITE: WeatherCRE.onReport(report) ───────────────────────────
  const timestamp = BigInt(Math.floor(Date.now() / 1000))
  const reportPayload = encodeAbiParameters(
    parseAbiParameters('string city, string temperature, uint256 timestamp, address sender'),
    [city, temperature, timestamp, requester],
  )

  const report = runtime
    .report({
      encodedPayload: hexToBase64(reportPayload),
      encoderName: 'evm',
      signingAlgo: 'ecdsa',
      hashingAlgo: 'keccak256',
    })
    .result()

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.weatherCREAddress as `0x${string}`,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (writeResult?.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`EVM write failed: ${writeResult?.errorMessage}`)
  }
  runtime.log(
    `WeatherCRE.onReport tx: ${bytesToHex(writeResult.txHash || new Uint8Array(32))}`,
  )

  return JSON.stringify({ city, temperature, requester })
}

// ─── Init ──────────────────────────────────────────────────────────────────

function addressToBase64(addressHex: string): string {
  // CRE logTrigger filter expects the 20-byte raw address encoded as base64.
  return Buffer.from(hexToBytes(addressHex as `0x${string}`)).toString('base64')
}

export function initWorkflow(config: Config) {
  network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainSelectorName,
    isTestnet: config.chainSelectorName.includes('testnet') || config.chainSelectorName.includes('sepolia'),
  })
  if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`)
  evmClient = new EVMClient(network.chainSelector.selector)

  // EVM Log Trigger — WeatherCRE :: WeatherRequested(string,address)
  const evmLogTrigger = evmClient.logTrigger({
    filter: {
      address: addressToBase64(config.weatherCREAddress),
      eventSignature: WEATHER_REQUESTED_SIGNATURE,
      // topic0 is keccak256 of the event signature
      topic0: Buffer.from(toBytes(keccak256(toBytes(WEATHER_REQUESTED_SIGNATURE)))).toString('base64'),
    },
    confidenceLevel: 'CONFIDENCE_LEVEL_FINALIZED',
  })

  return [
    cre.handler(evmLogTrigger.trigger({}), onWeatherRequested),
  ]
}
