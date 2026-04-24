import { sepolia } from 'viem/chains'

export const CHAIN = sepolia
export const DEFAULT_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000'

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
