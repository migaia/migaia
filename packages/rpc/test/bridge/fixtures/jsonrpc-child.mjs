import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { acceptRpcHandshake } from '../../../dist/contract/handshake.js'
import { serializeRpcError } from '../../../dist/contract/error.js'

/** The parent sends the secret through a dedicated fd, never argv, environment or RPC stdin. */
const token = readFileSync(3, 'utf8')
/** Explicit schema is handwritten so describe does not call the bridge implementation. */
const contract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: true },
        plain: { mode: 'request', idempotent: false },
        oneWay: { mode: 'one-way', idempotent: false }
      }
    }
  }
}
/** Host mode changes only the declared catalog and reserved control operations. */
const hostMode = process.argv.includes('--host')
/** Required profile operations are the entire supported surface of this test peer. */
const methods = ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel']

/**
 * Parse Content-Length independently and respond to one connection-local JSON-RPC session.
 *
 * @param {import('node:stream').Readable} input Incoming RPC bytes.
 * @param {import('node:stream').Writable} output Outgoing RPC bytes.
 * @returns {void}
 */
function serve(input, output) {
  /** Buffered peer bytes are consumed by declared byte count, independent of bridge framing. */
  let buffer = Buffer.alloc(0)
  /** The first physical RPC byte proves bootstrap never contaminated stdin. */
  let first
  /** Wire event snapshots prove notification/cancel order without reconstructing local intent. */
  const events = []
  /** Connection-local Host controls retain the independently observed install state. */
  const installed = new Set()
  /** Host revisions advance only when this peer changes installed membership. */
  let revision = 0
  /** Use/inspect project the frozen remote-control result shape. */
  const item = () => ({ name: 'p', state: 'enabled', revision, features: ['f'] })
  /** Encode each response as one canonical Content-Length write. */
  const send = (value) => {
    const body = Buffer.from(JSON.stringify(value))
    output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  input.on('data', (chunk) => {
    first ??= chunk[0]
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1])
      if (buffer.length < end + 4 + length) return
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
      buffer = buffer.subarray(end + 4 + length)
      events.push({ method: message.method, id: message.id, params: message.params })
      if (message.method === 'migaia.hello') {
        const hello = JSON.parse(message.params.hello)
        let reply
        if (hello.auth !== token) {
          const denied = new Error('Fixture authentication denied')
          Object.defineProperties(denied, {
            source: { value: 'jsonrpc-fixture' },
            code: { value: 'AUTH_DENIED' }
          })
          reply = JSON.stringify({
            kind: 'handshake',
            step: 'reject',
            protocol: 'migaia.rpc',
            error: serializeRpcError(denied, { report: () => undefined })
          })
        } else
          reply = acceptRpcHandshake(
            {
              versions: [{ major: 1, minor: 1 }],
              codecs: ['json'],
              capabilities: ['abort@1', 'jsonrpc-bridge@1', 'wire-error@1', 'deadline@1'],
              peer: { id: 'child', runtime: 'node' }
            },
            message.params.hello
          ).reply
        send({ jsonrpc: '2.0', id: message.id, result: { reply, methods } })
      } else if (message.method === 'migaia.describe')
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: hostMode ? { schemaVersion: 1, catalog: { p: contract } } : contract
        })
      else if (message.method === 'migaia.invoke' && message.id) {
        const args = message.params.args
        if (hostMode && message.params.method === 'migaia.remote.host.use') {
          installed.add(args[0])
          revision++
          send({ jsonrpc: '2.0', id: message.id, result: item() })
          continue
        }
        if (hostMode && message.params.method === 'migaia.remote.host.unUse') {
          installed.delete(args[0])
          revision++
          send({ jsonrpc: '2.0', id: message.id, result: { ok: true } })
          continue
        }
        if (hostMode && message.params.method === 'migaia.remote.host.inspect') {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: { revision, plugins: [...installed].map(item) }
          })
          continue
        }
        if (args[0] === '__wait') continue
        if (args[0] === '__stderr1') process.stderr.write(token.slice(0, token.length / 2))
        if (args[0] === '__stderr2') process.stderr.write(token.slice(token.length / 2))
        send({ jsonrpc: '2.0', id: message.id, result: { args, first, events: [...events] } })
      }
    }
  })
  input.on('end', () => output.end())
}

/** Optional socket path changes only the carrier; fd authentication and profile stay identical. */
const address = process.argv.slice(2).find((value) => !value.startsWith('--'))
if (address)
  createServer((socket) => serve(socket, socket)).listen(address, () =>
    process.stdout.write('ready')
  )
else serve(process.stdin, process.stdout)
