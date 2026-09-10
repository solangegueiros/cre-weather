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
let readings: Reading[] = []
let forwarderAddress: Address | null = null
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
  readings = []
  forwarderAddress = null
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

  await loadForwarder()
  if (account) await loadReadings()
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
    const detected = detectNetworkFromChainId(currentChainIdHex)

    if (detected) {
      // Wallet is on a known network — auto-select it
      await applyNetwork(detected)
    } else {
      // Unknown network — keep current selection, show warning
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
  const networkOptions = (Object.entries(NETWORKS) as [NetworkKey, (typeof NETWORKS)[NetworkKey]][])
    .map(
      ([key, net]) =>
        `<option value="${key}" ${key === selectedNetwork ? 'selected' : ''}>${net.label}</option>`,
    )
    .join('')

  app.innerHTML = `
    <header>
      <div class="header-logo">⛅</div>
      <div class="header-text">
        <h1>Weather CRE</h1>
        <p class="subtitle">Request weather via Chainlink CRE</p>
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
          <span class="label">Network:</span>
          <select id="network-select" class="network-select">${networkOptions}</select>
        </div>
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

      ${
        account
          ? `
            <div class="card">
              <div class="info-row">
                <div class="info-item">
                  <span class="label">Connected wallet</span>
                  <span class="value" style="font-family: monospace; font-size: .95rem;">${shortAddr(account)}</span>
                </div>
                <div class="info-item">
                  <span class="label">Network</span>
                  <span class="value" style="font-size: .95rem;">${NETWORKS[selectedNetwork].label}</span>
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
  document.getElementById('network-select')?.addEventListener('change', (e) => {
    switchNetwork((e.target as HTMLSelectElement).value as NetworkKey)
  })
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

if (window.ethereum) {
  // Re-connect if wallet was already authorized
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
    readings = []
    unknownNetwork = false
    if (account) loadReadings().then(render)
    else render()
  })

  // Auto-detect network when wallet switches chain
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
