/**
 * CRE Workflow: Weather
 *
 * Flow:
 *   1. EVM Log Trigger on WeatherCRE.WeatherRequested(city, requester)
 *   2. HTTP GET https://wttr.in/{city}?format=3&m  (plain-text weather line)
 *   3. EVM writeReport → WeatherCRE.onReport(report)
 *        report = abi.encode(string city, string temperature, uint256 timestamp, address sender)
 */
import {
  handler,
  getNetwork,
  type Runtime,
  type EVMLog,
  EVMClient,
  TxStatus,
  HTTPClient,
  hexToBase64,
  bytesToHex,
  text,
  ok,
  consensusIdenticalAggregation,
} from '@chainlink/cre-sdk'
import {
  type Address,
  parseAbi,
  parseAbiParameters,
  encodeAbiParameters,
  decodeEventLog,
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

// ─── Module-level EVMClient (initialized in initWorkflow) ──────────────────
let evmClient: EVMClient

const WEATHER_REQUESTED_ABI = parseAbi([
  'event WeatherRequested(string city, address requester)',
])
const WEATHER_REQUESTED_SIGNATURE = 'WeatherRequested(string,address)'

// ─── Handler ───────────────────────────────────────────────────────────────

export function onWeatherRequested(runtime: Runtime<Config>, log: EVMLog): string {
  runtime.log(`EVM Log: WeatherRequested | txHash: ${bytesToHex(log.txHash)}`)

  // Decode (city, requester) — log.data and log.topics are Uint8Array from protobuf
  const decoded = decodeEventLog({
    abi: WEATHER_REQUESTED_ABI,
    data: bytesToHex(log.data),
    topics: log.topics.map(t => bytesToHex(t)) as [`0x${string}`, ...`0x${string}`[]],
  })
  const city = decoded.args.city as string
  const requester = decoded.args.requester as Address
  runtime.log(`City: ${city}, Requester: ${requester}`)

  // ── HTTP GET: wttr.in ────────────────────────────────────────────────
  runtime.log(`Fetching weather for ${city}`)
  const httpClient = new HTTPClient()
  const temperature = httpClient.sendRequest(
    runtime,
    (sendRequester) => {
      const res = sendRequester
        .sendRequest({
          method: 'GET',
          url: `https://wttr.in/${encodeURIComponent(city)}?format=3&m`,
        })
        .result()
      if (!ok(res)) throw new Error(`HTTP GET failed: ${res.statusCode}`)
      return text(res)
    },
    consensusIdenticalAggregation<string>(),
  )().result()

  runtime.log(`Weather: ${temperature}`)

  // ── EVM WRITE: WeatherCRE.onReport(report) ───────────────────────────
  // Use runtime.now() for a deterministic DON-consensus timestamp (not Date.now())
  const timestamp = BigInt(Math.floor(runtime.now().getTime() / 1000))
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
      receiver: runtime.config.weatherCREAddress,
      report,
      gasConfig: { gasLimit: String(runtime.config.gasLimit) },
    })
    .result()

  if (writeResult?.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`EVM write failed: ${writeResult?.errorMessage}`)
  }
  runtime.log(`WeatherCRE.onReport tx: ${bytesToHex(writeResult.txHash || new Uint8Array(32))}`)

  return JSON.stringify({ city, temperature, requester })
}

// ─── Init ──────────────────────────────────────────────────────────────────

export function initWorkflow(config: Config) {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainSelectorName,
  })
  if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`)
  evmClient = new EVMClient(network.chainSelector.selector)

  const eventSignatureHash = keccak256(toBytes(WEATHER_REQUESTED_SIGNATURE))

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.weatherCREAddress)],
        topics: [
          { values: [hexToBase64(eventSignatureHash)] },
        ],
        confidence: 'CONFIDENCE_LEVEL_FINALIZED',
      }),
      onWeatherRequested,
    ),
  ]
}
