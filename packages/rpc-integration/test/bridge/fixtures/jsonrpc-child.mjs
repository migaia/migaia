import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { acceptRpcHandshake } from '@migaia/rpc-contract'
import { describeRemoteMethods } from '../../../../rpc-host/dist/remote/serve-methods.js'
import { serializeRpcError } from '@migaia/rpc-contract'

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
/** Busy-loop acknowledgement is flushed before this real child stops servicing RPC. */
process.on('SIGUSR2', () =>
  process.stderr.write('busy-loop-entered', () => {
    for (;;) {}
  })
)

/** Required profile operations are the entire supported surface of this test peer. */
const methods = ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel']

/**
 * Parse Content-Length independently and respond to one connection-local JSON-RPC session.
 *
 * @param {import('node:stream').Readable} input Incoming RPC bytes.
 * @param {import('node:stream').Writable} output Outgoing RPC bytes.
 * @returns {void}
 */
/** Connection-local JSON-RPC fixture state; framing remains independent of the bridge owner. */
class JsonRpcChildSession {
  /** Original native writer is borrowed until readable end. */
  #output
  /** Header bytes are retained once until CRLFCRLF, avoiding cumulative fragment copies. */
  #header = []
  /** Complete declared body has one allocation and each input byte is copied once. */
  #body
  /** Filled body prefix determines when the independent parser may decode one frame. */
  #bodyOffset = 0
  /** First physical byte proves FD bootstrap never contaminated RPC stdin. */
  #first
  /** Original wire event order is retained for notification and cancel assertions. */
  #events = []
  /** Only one physical batch collects its ordered replies before a single write. */
  #batchReplies

  /**
   * @param {import('node:stream').Readable} input Original RPC bytes. @param
   *   {import('node:stream').Writable} output Original native writer.
   */
  constructor(input, output) {
    this.#output = output
    input.on('data', (chunk) => this.#receive(chunk))
    input.on('end', () => output.end())
  }
  /** @param {Buffer} chunk Original native fragment. @returns {void} */
  #receive(chunk) {
    this.#first ??= chunk[0]
    let cursor = 0
    while (cursor < chunk.length) {
      if (!this.#body) {
        this.#header.push(chunk[cursor++])
        const length = this.#header.length
        if (
          length < 4 ||
          this.#header[length - 4] !== 13 ||
          this.#header[length - 3] !== 10 ||
          this.#header[length - 2] !== 13 ||
          this.#header[length - 1] !== 10
        )
          continue
        const header = Buffer.from(this.#header).toString()
        const size = Number(/Content-Length: (\d+)/i.exec(header)[1])
        this.#body = Buffer.alloc(size)
        this.#header = []
      }
      const length = Math.min(chunk.length - cursor, this.#body.length - this.#bodyOffset)
      this.#body.set(chunk.subarray(cursor, cursor + length), this.#bodyOffset)
      cursor += length
      this.#bodyOffset += length
      if (this.#bodyOffset !== this.#body.length) continue
      this.#physical(JSON.parse(this.#body.toString()))
      this.#body = undefined
      this.#bodyOffset = 0
    }
  }
  /** @param {unknown} value Original JSON-RPC response. @returns {void} */
  #send(value) {
    if (this.#batchReplies) {
      this.#batchReplies.push(value)
      return
    }
    const body = Buffer.from(JSON.stringify(value))
    this.#output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  /** @param {any} physical One independently parsed physical frame. @returns {void} */
  #physical(physical) {
    this.#batchReplies = Array.isArray(physical) ? [] : undefined
    for (const message of Array.isArray(physical) ? physical : [physical]) this.#message(message)
    const replies = this.#batchReplies
    this.#batchReplies = undefined
    if (replies?.length) this.#send(replies)
  }
  /** @param {any} message One original profile operation. @returns {void} */
  #message(message) {
    this.#events.push({ method: message.method, id: message.id, params: message.params })
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
            capabilities: [
              'runtime-api@1',
              'batch@1',
              'abort@1',
              'jsonrpc-bridge@1',
              'wire-error@1',
              'deadline@1'
            ],
            peer: { id: 'child', runtime: 'node' }
          },
          message.params.hello
        ).reply
      this.#send({ jsonrpc: '2.0', id: message.id, result: { reply, methods } })
    } else if (message.method === 'migaia.describe')
      this.#send({
        jsonrpc: '2.0',
        id: message.id,
        result: describeRemoteMethods([contract], { name: 'p', instanceId: 'peer' }, false)
      })
    else if (message.method === 'migaia.invoke' && message.id) {
      const args = message.params.args
      if (args[0] === '__wait') return
      if (args[0] === '__stderr1') process.stderr.write(token.slice(0, token.length / 2))
      if (args[0] === '__stderr2') process.stderr.write(token.slice(token.length / 2))
      this.#send({
        jsonrpc: '2.0',
        id: message.id,
        result: { args, first: this.#first, events: [...this.#events] }
      })
    }
  }
}
/**
 * @param {import('node:stream').Readable} input Original RPC bytes. @param
 *   {import('node:stream').Writable} output Original native writer. @returns {void}
 */
function serve(input, output) {
  new JsonRpcChildSession(input, output)
}

/** Optional socket path changes only the carrier; fd authentication and profile stay identical. */
const address = process.argv.slice(2).find((value) => !value.startsWith('--'))
if (address)
  createServer((socket) => serve(socket, socket)).listen(address, () =>
    process.stdout.write('ready')
  )
else serve(process.stdin, process.stdout)
