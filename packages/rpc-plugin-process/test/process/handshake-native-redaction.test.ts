/** Original hostile bootstrap fields cross actual native byte IO before Session admission. */
import { PassThrough } from 'node:stream'
import { inspect } from 'node:util'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcHost } from '@migaia/rpc-host'
import { serializeRpcError } from '@migaia/rpc-contract'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import {
  defineTransportPlugin,
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '@migaia/rpc-host/sdk'
import { createProcessCarrier } from '../../dist/process/carrier.js'
import { createAdapterChildStdio } from '../../dist/process/node-io.js'

/** Native streams and the current Process/Session owners supply every bootstrap and error object. */
class NativeHandshakeIngress {
  /** The original attacker writes into this actual Node readable stream. */
  readonly #towardHost = new PassThrough()
  /** Actual Session hello bytes reach the independent attacker's native reader. */
  readonly #awayHost = new PassThrough()
  /** The actual Process adapter owns the receiver's sole byte subscription and physical close. */
  readonly #raw = createAdapterChildStdio({ stdout: this.#towardHost, stdin: this.#awayHost })
  /** An independent native stream adapter writes malformed bytes without fabricating a Session. */
  readonly #attacker = createAdapterChildStdio({ stdout: this.#awayHost, stdin: this.#towardHost })
  /** Genuine Session attachment publishes its original readiness Promise before any attack. */
  readonly attached = deferred<IRpcSessionHandle>()
  /** One actual native pipe terminal witnesses physical shutdown independently of Session state. */
  readonly physicallyClosed = deferred<void>()
  /** Node emits this original acquired pipe's close once even if cleanup is reentered. */
  physicalCloses = 0
  /** The actual canonical hello supplies a current valid baseline, including its real directory. */
  readonly #hello = deferred<Record<string, unknown>>()
  /** This observer owns only its native read callback, never a replacement framing implementation. */
  readonly #remove: () => void
  /** Actual Host rollback remains observed while the original Session error is asserted. */
  readonly #opening: Promise<{ close(): Promise<void> }>

  /** Subscribe the attacker before opening the native source so the genuine first hello is retained. */
  constructor() {
    this.#towardHost.on('close', () => {
      this.physicalCloses += 1
      this.physicallyClosed.resolve()
    })
    /** Canonical physical framing decodes only the actual sender's baseline bootstrap. */
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (bytes) => {
        this.#hello.resolve(JSON.parse(new TextDecoder().decode(bytes)))
      },
      onError: this.#hello.reject
    })
    this.#remove = this.#attacker.onData((chunk) => decoder.push(chunk))
    this.#opening = createRpcHost({
      self: { name: 'redaction-target', instanceId: 'redaction-target' },
      report: () => undefined,
      plugins: [
        defineTransportPlugin({
          name: 'native-redaction-input',
          namespace: 'process',
          open: async (context) => {
            /** The exact canonical Process carrier owns native framing and error presentation. */
            const carrier = createProcessCarrier(this.#raw, context, { id: 'native-redaction' })
            /** This original SDK handle is asserted without replacing its readiness error. */
            const handle = context.attach(carrier)
            this.attached.resolve(handle)
            await handle.ready
            return { dispose: () => context.detach(handle) }
          }
        })
      ]
    })
    void this.#opening.catch(() => undefined)
  }
  /** Mutate one original hostile field, retaining every other valid current bootstrap member. */
  async send(position: 'kind' | 'step' | 'unknown-field', token: string): Promise<void> {
    /** The genuine first outgoing hello is the only baseline, with no duplicated protocol grammar. */
    const base = await this.#hello.promise
    /** Each original hostile position remains independently observable in the encoded input. */
    const hostile = JSON.stringify(
      position === 'kind'
        ? { ...base, kind: token }
        : position === 'step'
          ? { ...base, step: token }
          : { ...base, kind: 'invalid', [token]: 'unexpected' }
    )
    await this.#attacker.write(encodeRpcStreamFrame(new TextEncoder().encode(hostile)))
  }
  /** Join actual rollback and the same native resources without introducing another lifecycle. */
  async close(): Promise<void> {
    this.#remove()
    await Promise.all([this.#raw.close(), this.#attacker.close()])
    /** A malformed source normally rejects startup, while a fulfilled root still owns its cleanup. */
    const settled = await Promise.allSettled([this.#opening])
    for (const outcome of settled) if (outcome.status === 'fulfilled') await outcome.value.close()
  }
}

it.each(['kind', 'step', 'unknown-field'] as const)(
  'keeps hostile %s out of the local cause and wire report',
  async (position) => {
    /** All original hostile strings are retained unchanged through current native ingress. */
    const token = 'hostile-field-token'
    /** Real Node IO and the actual Session own admission and subsequent rollback. */
    const fixture = new NativeHandshakeIngress()
    try {
      /** The current native Session exposes its original bootstrap failure without a facade. */
      const handle = await fixture.attached.promise
      await fixture.send(position, token)
      /** Inspection and error serialization still traverse the original whole error graph. */
      const observed = await handle.ready.catch((error: unknown) => error)
      expect(inspect(observed, { depth: null, showHidden: true })).not.toContain(token)
      expect(
        JSON.stringify(serializeRpcError(observed, { report: () => undefined }))
      ).not.toContain(token)
      /** Malformed records fail the Contract envelope grammar; a hostile step fails the handshake. */
      expect(observed).toMatchObject({
        code: position === 'step' ? 'HANDSHAKE_INVALID' : 'INVALID_ENVELOPE'
      })
    } finally {
      await fixture.close()
    }
  }
)

it('uses the original manual deadline and closes the actual silent Process byte peer once', async () => {
  /** The original 9999/10000 boundary runs on the actual Host scheduler backend. */
  const scheduler = createManualScheduler()
  /** Session still owns its sole timer; the test only lends the existing manual clock. */
  const clock = vi
    .spyOn(systemScheduler, 'schedule')
    .mockImplementation((run, delay) => scheduler.schedule(run, delay))
  /** The actual native peer receives hello but intentionally sends no handshake response. */
  const fixture = new NativeHandshakeIngress()
  try {
    /** Only original Session readiness supplies the actual timeout failure. */
    const handle = await fixture.attached.promise
    scheduler.advance(9_999)
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(1)
    /** Observe original settlement before asserting independent timer and physical cleanup effects. */
    const observed = await handle.ready.catch((error: unknown) => error)
    await fixture.physicallyClosed.promise
    expect(scheduler.pendingCount).toBe(0)
    expect(fixture.physicalCloses).toBe(1)
    /** The attached Session's own handshake timer settles readiness. */
    expect(observed).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  } finally {
    await fixture.close()
    clock.mockRestore()
  }
})
