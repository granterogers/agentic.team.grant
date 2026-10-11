/**
 * The Hermes bridge process (Hermes, M5). Runs on the host that runs Hermes, outbound only.
 *
 *   npm run hermes:bridge          reads ENGINE_GATEWAY_URL, ENGINE_BRIDGE_TOKEN, HERMES_URL, HERMES_API_KEY from its environment
 *
 * Claiming and finishing a run writes to the office's database through the gateway, so this is a production write like a deploy: it
 * starts only where a person has set ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1 in the service's own environment
 * (docs/hermes/host/RUNBOOK.md). An authoring session without them cannot start it.
 *
 * It refuses to start on a bad configuration and prints WHY (never a value). It stops on SIGTERM/SIGINT after the run in hand has been
 * reported or given up, and exits non-zero if the gateway no longer recognises its token (a retired bridge must not keep polling).
 */
import '../../src/safety/require-production-writes.ts'
import { BRIDGE_VERSION, Bridge } from './bridge.ts'
import { parseBridgeConfig } from './config.ts'
import { GatewayClient } from './gateway-client.ts'
import { HermesClient } from './hermes-client.ts'

const parsed = parseBridgeConfig(process.env)
if (!parsed.ok) {
  console.error('The bridge will not start:')
  for (const p of parsed.problems) console.error(`  - ${p}`)
  process.exit(2)
}
const { config } = parsed
const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`)
const bridge = new Bridge({
  hermes: new HermesClient(config.hermesUrl, config.hermesKey),
  gateway: new GatewayClient(config.gatewayUrl, config.bridgeToken),
  config,
  log,
})
const stop = new AbortController()
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    log(`${sig}: finishing the run in hand, then stopping`)
    stop.abort()
  })
log(
  `bridge ${BRIDGE_VERSION} up; Hermes at ${config.hermesUrl}; the gateway's host is ${new URL(config.gatewayUrl).host}`,
)
const fatal = await bridge.serve(stop.signal)
if (fatal !== null) {
  log(`stopping: ${fatal}`)
  process.exit(1)
}
log('stopped')
