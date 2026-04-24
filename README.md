# Weather

A Chainlink CRE workflow that fetches weather from [wttr.in](https://wttr.in) on-demand, triggered by an on-chain event.

Inspired by [WeatherFunctionsSepolia.sol](https://github.com/solangegueiros/chainlink-bootcamp-2024/blob/main/WeatherFunctionsSepolia.sol) (Chainlink Functions version), reimplemented with the Chainlink Runtime Environment (CRE).

CRE workflow scaffolded in the style of [Scaffold CRE](https://github.com/tigeragentt/scaffold-cre).

## Flow

1. A user calls `WeatherCRE.getWeather(city)` on-chain.
2. The contract emits `WeatherRequested(city, requester)`.
3. The CRE workflow's **EVM Log Trigger** fires on that event.
4. The workflow issues an **HTTP GET** to `https://wttr.in/{city}?format=3&m`.
5. The workflow builds an ABI-encoded report and calls **`WeatherCRE.onReport`** via `writeReport`.
6. `onReport` decodes `(city, temperature, timestamp, sender)` and delegates to `weatherSet`, which appends the reading and emits `WeatherStored`.

## Project structure

```
project.yaml                      ← CRE project settings (RPC endpoints)
secrets.yaml                      ← Secrets template (no secrets needed — wttr.in is public)
.cre/template.yaml                ← CRE project metadata
contracts/
  WeatherCRE.sol                  ← Solidity contract
workflow-weather/                 ← Workflow folder
  main.ts                         ← Entry point
  workflow.ts                     ← Workflow logic (edit this)
  package.json
  tsconfig.json
  workflow.yaml                   ← Deploy targets
  config/
    config.staging.json           ← Staging config (Sepolia)
    config.production.json        ← Production config (mainnet)
frontend/                         ← Vite + TS + viem mini-dapp
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.2.21
- [Chainlink CRE CLI](https://docs.chain.link/cre/reference/cli)

## 1. Install dependencies

Run from the **project root directory**:

```bash
bun install --cwd ./workflow-weather
```

## 2. Deploy the contract and update config

- Deploy `contracts/WeatherCRE.sol` to Sepolia. The constructor sets `forwarder = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88` (Ethereum Sepolia CRE forwarder); use `setForwarder(...)` to override on other networks.
- Put the deployed contract address in `workflow-weather/config/config.staging.json` as `weatherCREAddress` (a default deployment at `0xDaF88B18644AA9AD79340C3316E72B098f6fbc3F` is prefilled — replace with your own if you redeploy).

## 3. Simulate the workflow

Run from the **project root directory**:

```bash
cre workflow simulate workflow-weather --target staging-settings
```

## 4. Send a real transaction on chain

On `.env`, define `CRE_ETH_PRIVATE_KEY`.
Use `--broadcast` to submit the transaction:

```bash
cre workflow simulate workflow-weather --target=staging-settings --broadcast
```

## Frontend

A Vite + TypeScript + viem mini-dapp lives in `frontend/`. It lets you connect a wallet, call `getWeather(city)`, and see the readings the CRE workflow writes back.

```bash
cd frontend
npm install
npm run dev
```

Edit the contract address in-app if you redeploy.

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial scaffold: Weather"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## References

- [CRE SDK docs](https://docs.chain.link/cre)
- [Chainlink Agent Skills](https://github.com/smartcontractkit/chainlink-agent-skills)
- [CRE Templates](https://github.com/smartcontractkit/cre-templates)
