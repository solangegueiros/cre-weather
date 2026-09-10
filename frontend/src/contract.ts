import { sepolia, type Chain } from 'viem/chains'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const monadTestnet: Chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
}

export type NetworkKey = 'sepolia' | 'monad-testnet'

export const NETWORKS: Record<NetworkKey, { chain: Chain; label: string; contractAddress: string }> = {
  'sepolia': {
    chain: sepolia,
    label: 'Ethereum Sepolia',
    contractAddress: '0xCbD2faF7D8860B91c9E7fD0821d4F8Fca10F4326',
  },
  'monad-testnet': {
    chain: monadTestnet,
    label: 'Monad Testnet',
    contractAddress: '0xEFc0864bF40832Bb2189203b66810948d05dfAb8',
  },
}

export const DEFAULT_NETWORK: NetworkKey = 'sepolia'

export const WEATHER_CRE_ABI = [
  {
    type: 'function',
    name: 'getWeather',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'city', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getReadingsCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getReadingsCountByRequester',
    stateMutability: 'view',
    inputs: [{ name: 'requester', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getReadingByRequester',
    stateMutability: 'view',
    inputs: [
      { name: 'requester', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'city', type: 'string' },
          { name: 'temperature', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'sender', type: 'address' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'forwarder',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'WeatherRequested',
    inputs: [
      { name: 'city', type: 'string', indexed: false },
      { name: 'requester', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WeatherStored',
    inputs: [
      { name: 'city', type: 'string', indexed: false },
      { name: 'temperature', type: 'string', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
      { name: 'sender', type: 'address', indexed: false },
    ],
  },
] as const
