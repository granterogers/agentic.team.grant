// biome-ignore-all lint/suspicious/noExplicitAny: a JSON-RPC request body is untyped
// biome-ignore-all format: a dense harness helper kept readable as written
/**
 * A one-tool MCP server over HTTP, for experiments that need Hermes's model request to carry a tool without the office's own MCP function
 * (the learning probes ask what Hermes does with SKILLS, which is independent of the office tools). Loopback only; it answers `list_projects`
 * with a fixed sentence and holds no data.
 */
import { createServer, type Server } from 'node:http'

export const startMiniMcp = async (port: number): Promise<{ readonly url: string; readonly server: Server; stop: () => void }> => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += String(c) })
    req.on('end', () => {
      let m: any = {}
      try { m = JSON.parse(body) } catch { /* not json */ }
      const reply = (result: unknown): void => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })) }
      if (m.method === 'initialize') return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'office', version: '0' } })
      if (m.id === undefined) { res.writeHead(202); return res.end() }
      if (m.method === 'tools/list') return reply({ tools: [{ name: 'list_projects', description: 'List projects.', inputSchema: { type: 'object', properties: {} } }] })
      if (m.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'two projects' }] })
      reply({})
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${String(port)}/mcp`, server, stop: () => { server.close() } }
}
