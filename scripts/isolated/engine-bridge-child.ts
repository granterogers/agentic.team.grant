/**
 * The bridge as its own process, for the acceptance proof's crash test (scripts/isolated/engine-bridge.ts): killing it with SIGKILL while
 * it holds a run is the one thing an in-process bridge cannot simulate. It is the real Bridge, configured through the real parseBridgeConfig
 * from its environment, and it does not import the production-write gate because it talks to loopback only. Never used outside the replica.
 */
import { Bridge } from '../hermes-bridge/bridge.ts'
import { parseBridgeConfig } from '../hermes-bridge/config.ts'
import { GatewayClient } from '../hermes-bridge/gateway-client.ts'
import { HermesClient } from '../hermes-bridge/hermes-client.ts'

const parsed = parseBridgeConfig(process.env)
if (!parsed.ok) {
  console.error(`bridge-child refused: ${parsed.problems.join('; ')}`)
  process.exit(2)
}
const { config } = parsed
const stop = new AbortController()
process.on('SIGTERM', () => stop.abort())
const bridge = new Bridge({
  hermes: new HermesClient(config.hermesUrl, config.hermesKey),
  gateway: new GatewayClient(config.gatewayUrl, config.bridgeToken),
  config,
  log: (line) => console.log(`bridge: ${line}`),
})
console.log('bridge-child up')
const fatal = await bridge.serve(stop.signal)
console.log(fatal === null ? 'bridge-child stopped' : `bridge-child fatal: ${fatal}`)
process.exit(fatal === null ? 0 : 1)
