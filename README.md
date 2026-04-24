# Weather

A Chainlink CRE workflow that fetches weather from [wttr.in](https://wttr.in) on-demand, triggered by an on-chain event.

Inspired by [WeatherFunctionsSepolia.sol](https://github.com/solangegueiros/chainlink-bootcamp-2024/blob/main/WeatherFunctionsSepolia.sol) (Chainlink Functions version), reimplemented with Chainlink Runtime Environment (CRE).

## Flow

1. A user calls `WeatherCRE.getWeather(city)` on-chain.
2. The contract emits `WeatherRequested(city, requester)`.
3. The CRE workflow's **EVM Log Trigger** fires on that event.
4. The workflow issues an **HTTP GET** to `https://wttr.in/{city}?format=3&m`.
5. The workflow builds an ABI-encoded report and calls **`WeatherCRE.onReport`** via `writeReport`.
6. `onReport` decodes `(city, temperature, timestamp, sender)` and stores the reading.

## Project layout

```
weather/
├── contracts/
│   └── WeatherCRE.sol                    # Solidity contract
├── workflow-weather/
│   ├── workflow.ts                       # CRE workflow code
│   ├── main.ts                           # Runner entrypoint
│   ├── workflow.yaml                     # CRE workflow settings
│   ├── package.json
│   ├── tsconfig.json
│   └── config/
│       ├── config.staging.json           # Staging config (Sepolia)
│       └── config.production.json        # Production config (mainnet)
├── project.yaml                          # CRE project-level settings (RPCs)
├── secrets.yaml                          # Secrets template (none required)
├── .cre/template.yaml                    # CRE template descriptor
├── .env                                  # Local env (do not commit real key)
└── .gitignore
```

## Setup checklist

- [ ] **Deploy `WeatherCRE.sol`** to your target network (Sepolia for staging).
- [ ] **Set the forwarder** — call `setForwarder(CRE_FORWARDER_ADDRESS)` so `onReport` accepts writes from the CRE forwarder for your target network.
- [ ] **Update config** — put the deployed contract address in `workflow-weather/config/config.staging.json` as `weatherCREAddress`.
- [ ] **Install dependencies**:
  ```
  cd workflow-weather
  bun install
  ```
- [ ] **Simulate** the workflow locally:
  ```
  cre workflow simulate
  ```
- [ ] **Deploy** the workflow once simulation passes (requires Early Access, a funded wallet, and a linked key).

## Trigger a reading

Once the workflow is running, call on-chain:

```solidity
weatherCRE.getWeather("Lisbon");
```

The CRE workflow will fetch `https://wttr.in/Lisbon?format=3&m` (e.g. `Lisbon: ⛅️ +17°C`) and call `onReport` back on the contract. Fetch the reading via:

```solidity
weatherCRE.readings(0);                             // public array accessor
weatherCRE.getReadingByRequester(msg.sender, 0);    // by-requester
```
