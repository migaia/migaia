/** Preserve early business delivery through the current public Process socket and Host owners. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { defineFlowPlugin, RpcFlowPoint, type IRpcFlowStage } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import type { IProcessByteChannel, IProcessByteListener } from '../../dist/process/types.js'

/** Real native peers send before the receiver completes its actual semantic acceptance. */
class EarlyProcessFrames {
  /** Only original public provider calls append received payloads in dispatch order. */
  readonly received: string[] = []
  /** Every background failure stays visible through the existing Host diagnostic outlet. */
  readonly reports: unknown[] = []
  /** The actual accepting reply is physically sent before its originating stage remains pending. */
  readonly accepted = deferred<void>()
  /** Existing native member publication proves the sender has a ready direct Session. */
  readonly ready = deferred<void>()
  /** The original two-hundredth business callback ends the receive wait without a polling timer. */
  readonly delivered = deferred<void>()
  /** Caller-owned acceptance work is released after the original 2ms subscription-delay window. */
  readonly #release = deferred<void>()
  /** The actual native adapter supplies the only bound loopback address and listener lifetime. */
  listener: IProcessByteListener | undefined
  /** Public Host cleanup alone closes accepted Sessions and their raw physical sockets. */
  readonly #hosts: { close(): Promise<void> }[] = []
  /** The original pending root construction remains observed until its acceptance completes. */
  #opening: Promise<unknown> | undefined
  /** Native dial supplies the original byte owner, whose physical completion alone is held. */
  #raw: IProcessByteChannel | undefined
  /** The real semantic hook identifies the next original write as the acceptance confirmation. */
  #holdAccept = false

  /** Mark only the genuine semantic accept; the native write below holds its physical completion. */
  readonly #accept: IRpcFlowStage<'handshakeOutbound'> = async (payload, next) => {
    if (payload.handshake.step === 'accept') this.#holdAccept = true
    await next(payload)
  }
  /** Send the same native bytes first, then delay completion while the peer is free to activate. */
  readonly #write: IProcessByteChannel['write'] = async (chunk, options) => {
    /** Capture before native completion permits unrelated ready-peer writes to reenter. */
    const held = this.#holdAccept
    this.#holdAccept = false
    await this.#raw!.write(chunk, options)
    if (held) {
      this.accepted.resolve()
      await this.#release.promise
    }
  }
  /** Original semantic dispatch supplies both payload identity and the finite completion barrier. */
  readonly #receive = (value: string): void => {
    this.received.push(value)
    if (this.received.length === 200) this.delivered.resolve()
  }
  /** Open the genuine native listener before the independent client begins acquisition. */
  async server() {
    /** The real listener retains its own native pending and accepted-Session ownership. */
    const server = await createRpcHost({
      self: { name: 'early-server', instanceId: 'early-server' },
      plugins: [
        processPlugin({
          listen: {
            kind: 'listener',
            address: 'tcp://127.0.0.1:0',
            listen: async (options) => {
              this.listener = await listenProcessByteChannel(options)
              return this.listener
            },
            verify: () => 'principal',
            createConnectionContext: () => ({
              peerId: 'early-client',
              ipc: { connectionId: 'early', sessionId: 'early', log: () => undefined }
            })
          }
        })
      ],
      report: (error) => {
        this.reports.push(error)
      }
    })
    this.#hosts.push(server)
    server.process.members.on('ready', () => this.ready.resolve())
    return server
  }
  /** The receiver registers its real provider before native source opening and waits on acceptance. */
  client() {
    /** This actual flow stage only holds user work at its admitted handshake boundary. */
    const gate = defineFlowPlugin({
      name: 'early-process-accept',
      setup: () => ({ stages: { [RpcFlowPoint.handshakeOutbound]: this.#accept } })
    })
    /** The public root installs the original Process dialer and semantic receive callback. */
    const opening = createRpcHost({
      self: { name: 'early-client', instanceId: 'early-client' },
      provide: { receive: this.#receive },
      plugins: [
        gate,
        processPlugin({
          connect: {
            target: {
              kind: 'connect',
              address: this.listener!.address,
              token: 'token',
              supervision: { restart: { mode: 'never' } },
              dial: async (address, signal) => {
                this.#raw = await dialProcessByteChannel({
                  address,
                  signal: signal as AbortSignal
                })
                return { ...this.#raw, write: this.#write }
              }
            }
          }
        })
      ],
      report: (error) => {
        this.reports.push(error)
      }
    })
    this.#opening = opening
    void opening.then(
      (host) => {
        this.#hosts.push(host)
      },
      (error) => {
        this.reports.push(error)
      }
    )
    return opening
  }
  /** Return only the original held accept stage, letting Host resume its own incoming tail. */
  release(): void {
    this.#release.resolve()
  }
  /** Join original construction before closing the same native Host resources. */
  async close(): Promise<void> {
    this.release()
    await Promise.allSettled([this.#opening])
    await Promise.all(this.#hosts.map((host) => host.close()))
  }
}

it('delivers 200/200 actual business frames after a 2 ms activation delay', async () => {
  /** Actual loopback TCP and both genuine Process installations own every transferred byte. */
  const fixture = new EarlyProcessFrames()
  /** The public sender is retained before the independently held receiver is constructed. */
  const server = await fixture.server()
  try {
    /** This is the original receiver construction, not a synthetic ready-state promise. */
    const opening = fixture.client()
    await fixture.accepted.promise
    await fixture.ready.promise
    /** Every public notify is physically accepted while the actual receiver remains unactivated. */
    const writes: Promise<unknown>[] = []
    for (let index = 0; index < 200; index++)
      writes.push(server.process.notify('receive', `frame-${index}`))
    await Promise.all(writes)
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
    expect(fixture.received).toEqual([])
    fixture.release()
    await opening
    await fixture.delivered.promise
    expect(fixture.received).toEqual(Array.from({ length: 200 }, (_, index) => `frame-${index}`))
    expect(fixture.reports).toEqual([])
  } finally {
    await fixture.close()
  }
})
