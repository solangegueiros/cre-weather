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
import {
  NETWORKS,
  DEFAULT_NETWORK,
  ZERO_ADDRESS,
  WEATHER_CRE_ABI,
  type NetworkKey,
} from './contract'

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
const STORAGE_KEY_NETWORK = 'weather-cre-network'
const storageKeyForNetwork = (n: NetworkKey) => `weather-cre-address-${n}`

let selectedNetwork: NetworkKey =
  (localStorage.getItem(STORAGE_KEY_NETWORK) as NetworkKey) || DEFAULT_NETWORK

function networkContractAddress(): Address {
  const saved = localStorage.getItem(storageKeyForNetwork(selectedNetwork)) as Address | null
  return saved || (NETWORKS[selectedNetwork].contractAddress as Address)
}

let contractAddress: Address = networkContractAddress()
let editingAddress = false
let account: Address | null = null
let txStatus: { kind: 'pending' | 'success' | 'error'; message: string } | null = null
let cityInput = ''
let myReadings: Reading[] = []
let allReadings: Reading[] = []
let unknownNetwork = false

let publicClient: PublicClient = createPublicClient({
  chain: NETWORKS[selectedNetwork].chain,
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

function detectNetworkFromChainId(chainIdHex: string): NetworkKey | null {
  const chainId = parseInt(chainIdHex, 16)
  for (const [key, net] of Object.entries(NETWORKS) as [NetworkKey, (typeof NETWORKS)[NetworkKey]][]) {
    if (net.chain.id === chainId) return key
  }
  return null
}

// ─── Apply network (local state only, no wallet chain switch) ─────────────
async function applyNetwork(key: NetworkKey): Promise<void> {
  selectedNetwork = key
  unknownNetwork = false
  localStorage.setItem(STORAGE_KEY_NETWORK, key)

  contractAddress = networkContractAddress()
  myReadings = []
  allReadings = []
  txStatus = null

  publicClient = createPublicClient({
    chain: NETWORKS[key].chain,
    transport: http(),
  })

  if (account && window.ethereum) {
    walletClient = createWalletClient({
      chain: NETWORKS[key].chain,
      transport: custom(window.ethereum),
    })
  }

  await loadAllReadings()
  if (account) await loadMyReadings()
  render()
}

// ─── Switch network (also requests wallet to change chain) ───────────────
async function switchNetwork(key: NetworkKey): Promise<void> {
  if (account && window.ethereum) {
    const chain = NETWORKS[key].chain
    const desiredHex = '0x' + chain.id.toString(16)
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: desiredHex }],
      })
    } catch (switchErr: any) {
      if (switchErr?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: desiredHex,
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: chain.rpcUrls.default.http,
                blockExplorerUrls: chain.blockExplorers
                  ? [chain.blockExplorers.default.url]
                  : [],
              },
            ],
          })
        } catch {
          console.warn('Failed to add chain to wallet')
        }
      }
    }
    // chainChanged event will fire and call applyNetwork — don't duplicate work
    return
  }
  // No wallet connected — just update local state
  await applyNetwork(key)
}

// ─── Data loaders ────────────────────────────────────────────────────────
async function loadMyReadings(): Promise<void> {
  if (!account || contractAddress.toLowerCase() === ZERO_ADDRESS) {
    myReadings = []
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
    myReadings = loaded
  } catch (e) {
    console.warn('loadMyReadings failed:', e)
    myReadings = []
  }
}

async function loadAllReadings(): Promise<void> {
  if (contractAddress.toLowerCase() === ZERO_ADDRESS) {
    allReadings = []
    return
  }
  try {
    const contract = getContractInstance()
    const count = (await contract.read.getReadingsCount()) as bigint
    const total = Number(count)
    if (total === 0) { allReadings = []; return }
    const loaded: Reading[] = []
    const start = Math.max(0, total - 20)
    for (let i = total - 1; i >= start; i--) {
      const r = (await contract.read.readings([BigInt(i)])) as Reading
      loaded.push(r)
    }
    allReadings = loaded
  } catch (e) {
    console.warn('loadAllReadings failed:', e)
    allReadings = []
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
    const detected = detectNetworkFromChainId(currentChainIdHex)

    if (detected) {
      await applyNetwork(detected)
    } else {
      unknownNetwork = true
      walletClient = createWalletClient({
        chain: NETWORKS[selectedNetwork].chain,
        transport: custom(window.ethereum),
      })
      render()
    }
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

  const chain = NETWORKS[selectedNetwork].chain
  txStatus = { kind: 'pending', message: `Requesting weather for "${city}"…` }
  render()

  try {
    const hash = (await walletClient.writeContract({
      address: contractAddress,
      abi: WEATHER_CRE_ABI,
      functionName: 'getWeather',
      args: [city],
      account,
      chain,
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
      pollReadingsForUpdate(myReadings.length)
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
    await loadMyReadings()
    await loadAllReadings()
    if (myReadings.length > prevCount) {
      render()
      return
    }
  }
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
  localStorage.setItem(storageKeyForNetwork(selectedNetwork), contractAddress)
  editingAddress = false
  myReadings = []
  allReadings = []
  loadAllReadings().then(async () => {
    if (account) await loadMyReadings()
    render()
  })
}

// ─── Render helpers ───────────────────────────────────────────────────────
function renderReadingsTable(rows: Reading[], showWho: boolean): string {
  if (rows.length === 0) return ''
  return `
    <table class="readings-table">
      <thead>
        <tr>
          <th>City</th>
          <th>Date</th>
          <th>Weather</th>
          ${showWho ? '<th>Who</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>
            <td>${r.city}</td>
            <td class="mono-sm">${fmtTime(r.timestamp)}</td>
            <td class="weather-cell">${r.temperature}</td>
            ${showWho ? `<td class="mono-sm">${shortAddr(r.sender)}</td>` : ''}
          </tr>
        `,
          )
          .join('')}
      </tbody>
    </table>
  `
}

// ─── Render ──────────────────────────────────────────────────────────────
function render(): void {
  const app = document.getElementById('app')!
  const isAddressSet = contractAddress.toLowerCase() !== ZERO_ADDRESS
  const networkOptions = (Object.entries(NETWORKS) as [NetworkKey, (typeof NETWORKS)[NetworkKey]][])
    .map(
      ([key, net]) =>
        `<option value="${key}" ${key === selectedNetwork ? 'selected' : ''}>${net.label}</option>`,
    )
    .join('')

  app.innerHTML = `
    <header>
      <div class="header-left">
        <div class="header-logo">⛅</div>
        <div class="header-text">
          <h1>Weather CRE</h1>
          <p class="subtitle">Request weather via Chainlink CRE</p>
        </div>
      </div>
      <div class="header-right">
        <a class="github-btn" href="/tutorial.html" target="_blank" rel="noopener" title="Tutorial">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          Tutorial
        </a>
        <a class="github-btn" href="https://github.com/solangegueiros/cre-weather" target="_blank" rel="noopener" title="View on GitHub">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.087.636-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
          GitHub
        </a>
        <select id="network-select" class="network-select-header">${networkOptions}</select>
        ${
          account
            ? `<div class="wallet-chip"><span class="dot"></span>${shortAddr(account)}</div>`
            : `<button class="btn-connect-header" id="connect-btn-header">Connect Wallet</button>`
        }
      </div>
    </header>

    <div class="app">
      ${
        unknownNetwork
          ? `<div class="tx-status error" style="margin-bottom:1rem">
               Wallet is on an unsupported network. Switch to Ethereum Sepolia or Monad Testnet.
             </div>`
          : ''
      }

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
      </div>

      <div class="card">
        <h2>Request weather</h2>
        <div class="input-group">
          <input id="city-input" type="text" placeholder="City (e.g. Lisbon)" value="${cityInput}" />
        </div>
        ${
          account
            ? `<button class="btn btn-primary" id="request-btn" ${
                !isAddressSet || unknownNetwork ? 'disabled' : ''
              }>Get Weather</button>`
            : `<button class="btn btn-primary" id="connect-btn">Connect Wallet</button>`
        }
        ${
          !isAddressSet
            ? `<p class="hint">Set the WeatherCRE contract address above to enable requests.</p>`
            : ''
        }
        ${txStatus ? `<div class="tx-status ${txStatus.kind}">${txStatus.message}</div>` : ''}
      </div>

      <div class="card">
        <h2>My Weather</h2>
        ${
          !account
            ? `<p class="empty">Connect a wallet to see your weather readings.</p>`
            : myReadings.length === 0
              ? `<p class="empty">No readings yet. Request one above.</p>`
              : renderReadingsTable(myReadings, false)
        }
      </div>

      <div class="card">
        <h2>All Weather</h2>
        ${
          allReadings.length === 0
            ? `<p class="empty">No readings stored yet.</p>`
            : renderReadingsTable(allReadings, true)
        }
      </div>
    </div>
  `

  // wire up events
  document.getElementById('network-select')?.addEventListener('change', (e) => {
    switchNetwork((e.target as HTMLSelectElement).value as NetworkKey)
  })
  document.getElementById('connect-btn-header')?.addEventListener('click', connectWallet)
  document.getElementById('address-copy')?.addEventListener('click', () =>
    copyToClipboard(contractAddress),
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
loadAllReadings().then(render)

// Auto-refresh all readings every 30 s so new readings from other wallets appear
setInterval(async () => {
  await loadAllReadings()
  render()
}, 30_000)

if (window.ethereum) {
  window.ethereum.request({ method: 'eth_accounts' }).then(async (accounts: Address[]) => {
    if (accounts?.length) {
      account = accounts[0]
      const currentChainIdHex = (await window.ethereum.request({ method: 'eth_chainId' })) as string
      const detected = detectNetworkFromChainId(currentChainIdHex)
      if (detected) {
        await applyNetwork(detected)
      } else {
        unknownNetwork = true
        walletClient = createWalletClient({
          chain: NETWORKS[selectedNetwork].chain,
          transport: custom(window.ethereum),
        })
        render()
      }
    }
  })

  window.ethereum.on?.('accountsChanged', (accs: Address[]) => {
    account = accs?.[0] ?? null
    walletClient = account
      ? createWalletClient({
          chain: NETWORKS[selectedNetwork].chain,
          transport: custom(window.ethereum),
        })
      : null
    myReadings = []
    unknownNetwork = false
    if (account) loadMyReadings().then(render)
    else render()
  })

  window.ethereum.on?.('chainChanged', (chainIdHex: string) => {
    const detected = detectNetworkFromChainId(chainIdHex)
    if (detected) {
      applyNetwork(detected)
    } else {
      unknownNetwork = true
      render()
    }
  })
}
