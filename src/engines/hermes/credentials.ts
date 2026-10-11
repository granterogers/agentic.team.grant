/**
 * The two credentials a Hermes bridge host holds, generated and hashed in one place (M2). Pure apart from the random source, which is
 * injectable so a test can prove the shape and the hashing without a secret ever being real.
 *
 *   bridge token   ebt_<64 hex>   authenticates the bridge to the engine gateway. It names no office: the office is what the
 *                                 credential establishes.
 *   MCP token      mcp_<48 hex>   the one Hermes presents to the office's MCP function. Read tools only, bound to the bridge's
 *                                 current run by app.engine_tool_gate.
 *
 * Only the SHA-256 of each is ever stored (engine_bridges.token_sha256, mcp_clients.token_sha256). The clear values exist in this
 * process until they are handed to the person, and are never printed, logged, or written to a file by the code in this repository.
 * The shapes are chosen so the secret scanner and the redactor (app.engine_redact) both recognise a leaked one.
 */
import { createHash, randomBytes } from 'node:crypto'

export interface BridgeCredentials {
  /** Shown to the person once and placed in the host's `.env`. */
  readonly bridgeToken: string
  /** Placed in the host's `.env` as OFFICE_ENGINE_MCP_TOKEN. */
  readonly mcpToken: string
  readonly bridgeSha256: string
  readonly mcpSha256: string
}

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

export const generateCredentials = (
  random: (bytes: number) => Uint8Array = (n) => randomBytes(n),
): BridgeCredentials => {
  const hex = (n: number): string =>
    Array.from(random(n))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  const bridgeToken = `ebt_${hex(32)}`
  const mcpToken = `mcp_${hex(24)}`
  return {
    bridgeToken,
    mcpToken,
    bridgeSha256: sha256Hex(bridgeToken),
    mcpSha256: sha256Hex(mcpToken),
  }
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The statement that mints a bridge. It carries the two HASHES and the person's name for the host, never a token: a statement is
 * something a log or an error can repeat.
 */
export const mintStatement = (office: string, displayName: string, c: BridgeCredentials): string =>
  `select app.engine_mint_bridge(p_office => ${lit(office)}::uuid, p_engine => 'hermes', p_display => ${lit(displayName)}, ` +
  `p_bridge_token_sha256 => ${lit(c.bridgeSha256)}, p_mcp_token_sha256 => ${lit(c.mcpSha256)}) as r`

export const retireStatement = (office: string, bridge: string, reason: string): string =>
  `select app.engine_retire_bridge(p_office => ${lit(office)}::uuid, p_bridge => ${lit(bridge)}::uuid, p_reason => ${lit(reason)}) as r`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const isUuid = (v: string): boolean => UUID.test(v)
