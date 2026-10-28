/** Repeat real process-connect acquisitions over original Node byte streams and SDK codecs. */
import { PassThrough, Writable } from 'node:stream'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { defineTransportPlugin, type IRpcNativePoolMember } from '@migaia/rpc-host/sdk'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { createAdapterChildStdio } from '../../rpc-plugin-process/dist/process/node-io.js'
import { acceptProcessConnectionBootstrap } from '../../rpc-plugin-process/dist/process/connection-bootstrap.js'
import { createProcessCarrier } from '../../rpc-plugin-process/dist/process/carrier.js'
import { pool } from '../dist/index.js'
import { observingPool } from './pool-fixture.ts'

/**
 * In-memory stand-in for a pipe. A real pipe completes a write only after the kernel holds the
 * bytes, so the carrier may reuse its frame buffer; PassThrough keeps the caller's memory queued,
 * so each chunk is copied here to give the same ownership.
 */
function copyingWriter(target: PassThrough): Writable {
  return new Writable({
    write: (chunk: Uint8Array, _encoding, callback) => {
      target.write(Buffer.from(chunk), callback)
    },
    final: (callback) => {
      target.end(callback)
    }
  })
}

/** Original acquisition and cleanup gates remain outside real native constructors. */
type IRepeatableConnectOptions = Readonly<{
  beforeOpen?(index: number): void | Promise<void>
  closeErrors?: readonly unknown[]
  provide?(index: number): IRpcHostOptions['provide']
}>

/** The fixture owns genuine native byte endpoints and actual opposite public Hosts. */
class RepeatableConnectFixture {
  /** Only case data and cold provider factories are retained. */
  readonly #options: IRepeatableConnectOptions
  /** Actual attempted native resource openings are observed before their optional gates. */
  #opens = 0
  /** Successful native dial order identifies the independently accepted opposite Host. */
  #dials = 0
  /** Opposite public hosts are observations, never substitutes for native resource state. */
  readonly remotes: Readonly<{ self: Readonly<{ instanceId: string }>; close(): Promise<void> }>[] =
    []
  /** Exact native identity selects the corresponding opposite Host without a per-close scan. */
  readonly #remoteIds = new Map<
    string,
    Readonly<{ self: Readonly<{ instanceId: string }>; close(): Promise<void> }>
  >()
  /** Public diagnostic receipts remain available instead of swallowing native failures. */
  readonly reports: unknown[] = []
  /** Real source cleanup order is recorded at the existing native member boundary. */
  readonly closeOrder: number[] = []
  /** Only actual native member resources are exposed to isolation assertions. */
  readonly members: IRpcNativePoolMember[] = []
  /** Store options without creating a stream, supervisor, codec or Host. */
  constructor(options: IRepeatableConnectOptions) {
    this.#options = options
  }
  /** Every installed feature reuses the actual process-connect native constructor. */
  transport(feature = pool({ size: 1 })) {
    return processPlugin({
      connect: {
        target: {
          kind: 'connect',
          address: 'native-byte-fixture',
          token: 'fixture-credential',
          dial: this.#dial
        }
      },
      features: [
        observingPool(feature, this.members, {
          beforeOpen: this.#options.beforeOpen,
          closeErrors: this.#options.closeErrors,
          closeOrder: this.closeOrder,
          afterClose: this.#afterClose,
          opened: () => {
            this.#opens++
          }
        })
      ],
      report: this.#report
    })
  }
  /** Native and provider diagnostics remain available without a second transport error policy. */
  readonly #report = (error: unknown): void => {
    this.reports.push(error)
  }

  /** Counter ownership remains the real native feature acquisition port. */
  opens(): number {
    return this.#opens
  }
  /** Native Node streams carry actual framed bytes; the same canonical codec handles both ends. */
  readonly #dial = async () => {
    const index = this.#dials++
    const toRemote = new PassThrough()
    const fromRemote = new PassThrough()
    const local = createAdapterChildStdio({ stdout: fromRemote, stdin: copyingWriter(toRemote) })
    const remote = createAdapterChildStdio({ stdout: toRemote, stdin: copyingWriter(fromRemote) })
    const opening = createRpcHost({
      self: { name: `member-${index}`, instanceId: `member-${crypto.randomUUID()}` },
      report: this.#report,
      provide: this.#options.provide?.(index) ?? {
        identity: () => index,
        echo: (value: unknown) => value
      },
      plugins: [
        defineTransportPlugin({
          name: `native-remote-${index}`,
          namespace: 'process',
          open: async (context) => {
            /** The dialing process plugin proves its token before any Session frame is exchanged. */
            const admitted = await acceptProcessConnectionBootstrap(
              remote,
              { token: 'fixture-credential' },
              { signal: context.signal, report: this.#report }
            )
            /** The accepted side uses the same process carrier as the dialing plugin. */
            const id = `remote-${crypto.randomUUID()}`
            const session = context.attach(
              createProcessCarrier(admitted.channel, context, {
                id,
                ipc: { connectionId: id, sessionId: id, log: () => undefined }
              }),
              undefined,
              admitted.connectionContext
            )
            await session.ready
            return { dispose: session.close }
          }
        })
      ]
    })
    void opening.then(
      (host) => {
        this.remotes.push(host)
        this.#remoteIds.set(host.self.instanceId, host)
      },
      (error) => this.reports.push(error)
    )
    return local
  }
  /** Release only the opposite Host belonging to this exact native connection. */
  readonly #afterClose = async (instanceId: string | undefined): Promise<void> => {
    if (!instanceId) return
    const host = this.#remoteIds.get(instanceId)
    this.#remoteIds.delete(instanceId)
    await host?.close()
  }

  /** Close opposite original Hosts after their corresponding native resources have drained. */
  async close(): Promise<void> {
    await Promise.all(this.remotes.map((host) => host.close()))
  }
}

/** Existing repeatable-connect assertions share actual native recipes, without an adapter grammar. */
export function repeatableConnect(options: IRepeatableConnectOptions = {}) {
  return new RepeatableConnectFixture(options)
}
