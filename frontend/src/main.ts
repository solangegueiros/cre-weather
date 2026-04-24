import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  getContract,
  type Address,
  type WalletClient,
  type PublicClient,
  type Hex,
} from 'viem'
import { CHAIN, DEFAULT_CONTRACT_ADDRESS, WEATHER_CRE_ABI, ZERO_ADDRESS } from './contract'

// ─── Types ───────────────────────────────────────────────────────────────
declare global {
  interface Window {
    ethereum?: any
  }
}

type Reading = {
  city: string
  temperature: string
  timestamp: bigint
  sender: Address
}

// ─── State ───────────────────────────────────────────────────────────────
const STORAGE_KEY = 'weather-cre-address'
let contractAddress: Address = (
  (localStorage.getItem(STORAGE_KEY) as Address) || DEFAULT_CONTRACT_ADDRESS
) as Address
let editingAddress = false
let account: Address | null = null
let txStatus: { kind: 'pending' | 'success' | 'error'; message: string } | null = null
let cityInput = ''
let readings: Reading[] = []
let forwarderAddress: Address | null = null

const publicClient: PublicClient = createPublicClient({
  chain: CHAIN,
  transport: http(),
})

let walletClient: WalletClient | null = null

// ─── Helpers ─────────────────────────────────────────────────────────────
function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}
function fmtTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString()
}
function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text)
}

function getContractInstance() {
  return getContract({
    address: contractAddress,
    abi: WEATHER_CRE_ABI,
    client: { public: publicClient, wallet: walletClient || undefined },
  })
}

// ─── Data loaders ────────────────────────────────────────────────────────
async function loadReadings(): Promise<void> {
  if (!account || contractAddress.toLowerCase() === ZERO_ADDRESS) {
    readings = []
    return
  }
  try {
    const contract = getContractInstance()
    const count = (await contract.read.getReadingsCountByRequester([account])) as bigint
    const loaded: Reading[] = []
    const total = Number(count)
    const start = Math.max(0, total - 10)
    for (let i = total - 1; i >= start; i--) {
      const r = (await contract.read.getReadingByRequester([account, BigInt(i)])) as Reading
      loaded.push(r)
    }
    readings = loaded
  } catch (e) {
    console.warn('loadReadings failed:', e)
    readings = []
  }
}

async function loadForwarder(): Promise<void> {
  if (contractAddress.toLowerCase() === ZERO_ADDRESS) {
    forwarderAddress = null
    return
  }
  try {
    const contract = getContractInstance()
    forwarderAddress = (await contract.read.forwarder()) as Address
  } catch {
    forwarderAddress = null
  }
}

// ─── Wallet ──────────────────────────────────────────────────────────────
async function connectWallet(): Promise<void> {
  if (!window.ethereum) {
    alert('No injected wallet detected. Install MetaMask or another Ethereum wallet.')
    return
  }
  try {
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as Address[]
    account = accounts[0]

    const currentChainIdHex = (await window.ethereum.request({ method: 'eth_chainId' })) as string
    const desiredHex = '0x' + CHAIN.id.toString(16)
    if (currentChainIdHex.toLowerCase() !== desiredHex) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: desiredHex }],
        })
      } catch (e) {
        console.warn('Chain switch declined:', e)
      }
    }

    walletClient = createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) })
    await loadReadings()
    render()
  } catch (e) {
    console.error(e)
  }
}

// ─── Write: getWeather(city) ─────────────────────────────────────────────
async function requestWeather(): Promise<void> {
  if (!walletClient || !account) {
    await connectWallet()
    if (!walletClient || !account) return
  }
  const city = cityInput.trim()
  if (!city) {
    txStatus = { kind: 'error', message: 'Enter a city name first.' }
    render()
    return
  }
  if (contractAddress.toLowerCase() === ZERO_ADDRESS) {
    txStatus = { kind: 'error', message: 'Set the WeatherCRE contract address first.' }
    render()
    return
  }

  txStatus = { kind: 'pending', message: `Requesting weather for "${city}"…` }
  render()

  try {
    const hash = (await walletClient.writeContract({
      address: contractAddress,
      abi: WEATHER_CRE_ABI,
      functionName: 'getWeather',
      args: [city],
      account,
      chain: CHAIN,
    })) as Hex
    txStatus = { kind: 'pending', message: `Tx submitted: ${hash}. Waiting…` }
    render()

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'success') {
      txStatus = {
        kind: 'success',
        message: `WeatherRequested emitted. CRE workflow will fetch and store in ~1 block.`,
      }
      cityInput = ''
      // readings get stored by CRE asynchronously; poll for ~30s
      pollReadingsForUpdate(readings.length)
    } else {
      txStatus = { kind: 'error', message: 'Transaction reverted.' }
    }
    render()
  } catch (e: any) {
    txStatus = { kind: 'error', message: e?.shortMessage || e?.message || String(e) }
    render()
  }
}

async function pollReadingsForUpdate(prevCount: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 120_000) {
    await new Promise((r) => setTimeout(r, 5000))
    await loadReadings()
    if (readings.length > prevCount) {
      render()
      return
    }
  }
  // timed out, still render whatever we have
  render()
}

// ─── Address editing ─────────────────────────────────────────────────────
function saveAddress(next: string): void {
  const trimmed = next.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    alert('Invalid Ethereum address.')
    return
  }
  contractAddress = trimmed as Address
  localStorage.setItem(STORAGE_KEY, contractAddress)
  editingAddress = false
  readings = []
  forwarderAddress = null
  loadForwarder().then(() => {
    if (account) loadReadings().then(render)
    else render()
  })
}

// ─── Render ──────────────────────────────────────────────────────────────
function render(): void {
  const app = document.getElementById('app')!
  const isAddressSet = contractAddress.toLowerCase() !== ZERO_ADDRESS

  app.innerHTML = `
    <header>
      <div class="header-logo">⛅</div>
      <div class="header-text">
        <h1>Weather CRE</h1>
        <p class="subtitle">Request weather via Chainlink CRE on Sepolia</p>
      </div>
    </header>

    <div class="app">
      <div class="card contracts-box">
        <div class="contract-row">
          <span class="label">WeatherCRE:</span>
          ${
            editingAddress
              ? `
                <div class="edit-address">
                  <input id="address-input" type="text" value="${contractAddress}" placeholder="0x…" />
                  <button class="btn-copy" id="address-save">Save</button>
                  <button class="btn-copy" id="address-cancel">Cancel</button>
                </div>
              `
              : `
                <span class="address-inline">
                  <code>${contractAddress}</code>
                  <button class="btn-copy" id="address-copy">Copy</button>
                  <button class="btn-copy" id="address-edit">Edit</button>
                </span>
              `
          }
        </div>
        ${
          forwarderAddress
            ? `
              <div class="contract-row">
                <span class="label">Forwarder:</span>
                <span class="address-inline">
                  <code>${forwarderAddress}</code>
                  <button class="btn-copy" id="forwarder-copy">Copy</button>
                </span>
              </div>
            `
            : ''
        }
      </div>

      <div class="card">
        <h2>Request weather</h2>
        <div class="input-group">
          <input id="city-input" type="text" placeholder="City (e.g. Lisbon)" value="${cityInput}" />
        </div>
        ${
          account
            ? `<button class="btn btn-primary" id="request-btn" ${
                !isAddressSet ? 'disabled' : ''
              }>Get Weather</button>`
            : `<button class="btn btn-primary" id="connect-btn">Connect Wallet</button>`
        }
        ${
          !isAddressSet
            ? `<p class="hint">Set the WeatherCRE contract address above to enable requests.</p>`
            : ''
        }
        ${
          txStatus
            ? `<div class="tx-status ${txStatus.kind}">${txStatus.message}</div>`
            : ''
        }
      </div>

      ${
        account
          ? `
            <div class="card">
              <div class="info-row">
                <div class="info-item">
                  <span class="label">Connected wallet</span>
                  <span class="value" style="font-family: monospace; font-size: .95rem;">${shortAddr(
                    account,
                  )}</span>
                </div>
                <div class="info-item">
                  <span class="label">Network</span>
                  <span class="value" style="font-size: .95rem;">${CHAIN.name}</span>
                </div>
              </div>
            </div>
          `
          : ''
      }

      <div class="card">
        <h2>Your readings</h2>
        ${
          !account
            ? `<p class="empty">Connect a wallet to see your weather readings.</p>`
            : readings.length === 0
              ? `<p class="empty">No readings yet. Request one above.</p>`
              : `<div class="readings-list">${readings
                  .map(
                    (r) => `
                  <div class="reading-item">
                    <div class="city">${r.city}</div>
                    <div class="temp">${r.temperature}</div>
                    <div class="meta">${fmtTime(r.timestamp)} · from ${shortAddr(r.sender)}</div>
                  </div>
                `,
                  )
                  .join('')}</div>`
        }
      </div>
    </div>
  `

  // wire up events
  document.getElementById('address-copy')?.addEventListener('click', () =>
    copyToClipboard(contractAddress),
  )
  document.getElementById('forwarder-copy')?.addEventListener('click', () =>
    forwarderAddress && copyToClipboard(forwarderAddress),
  )
  document.getElementById('address-edit')?.addEventListener('click', () => {
    editingAddress = true
    render()
  })
  document.getElementById('address-save')?.addEventListener('click', () => {
    const v = (document.getElementById('address-input') as HTMLInputElement).value
    saveAddress(v)
  })
  document.getElementById('address-cancel')?.addEventListener('click', () => {
    editingAddress = false
    render()
  })
  const cityEl = document.getElementById('city-input') as HTMLInputElement | null
  if (cityEl) {
    cityEl.addEventListener('input', (e) => {
      cityInput = (e.target as HTMLInputElement).value
    })
    cityEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') requestWeather()
    })
  }
  document.getElementById('connect-btn')?.addEventListener('click', connectWallet)
  document.getElementById('request-btn')?.addEventListener('click', requestWeather)
}

// ─── Boot ────────────────────────────────────────────────────────────────
render()
loadForwarder().then(render)

// Re-connect if the wallet was already authorized
if (window.ethereum) {
  window.ethereum.request({ method: 'eth_accounts' }).then((accounts: Address[]) => {
    if (accounts?.length) {
      account = accounts[0]
      walletClient = createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) })
      loadReadings().then(render)
    }
  })
  window.ethereum.on?.('accountsChanged', (accs: Address[]) => {
    account = accs?.[0] ?? null
    walletClient = account ? createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) }) : null
    readings = []
    if (account) loadReadings().then(render)
    else render()
  })
  window.ethereum.on?.('chainChanged', () => window.location.reload())
}
