/** Uses actual public Hosts, JSON capture and HMAC to prove conditional backing integrity. */
import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { createRpcBackingDigest, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode, RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcProtocolError } from '@migaia/rpc-contract/errors'
import { deferred } from '@migaia/utils/promise'
import { coreMemoryServer } from '../../host/core-fixture.js'

/** This public test key uses the unchanged HMAC callback algorithm. */
const signingKey = 'core-refactor-public-fixture-key'

/** Count real native digest invocations separately for each actual prepare and restore operation. */
class BinaryCodecObservation {
  /** Only original complete backings handed to native SHA-256 enter this record. */
  readonly digests: ArrayBuffer[] = []
  /** Stage-local deltas distinguish sender capture from receiver verification. */
  readonly steps: Array<{ stage: 'prepare' | 'restore'; hashes: number }> = []
  /** Session's public protocol report must retain this exact original codec integrity failure. */
  readonly restoreFailures: unknown[] = []
  /** The actual SDK codec executes every stage; spies retain its original receiver. */
  readonly codec: RpcJsonCarrierCodec

  /** Reuse available native crypto rather than substituting an identity digest. */
  constructor() {
    /** The SDK captures the real platform digest callable and builtin receiver. */
    const digest = createRpcBackingDigest()
    expect(digest).toBeTypeOf('function')
    this.codec = new RpcJsonCarrierCodec({
      digest: (backing) => {
        this.digests.push(backing)
        return digest!(backing)
      }
    })
    /** Original methods own their private codec state throughout observation. */
    const prepare = this.codec.prepare
    /** Restoration uses the same real digest while retaining a separate operation receipt. */
    const restore = this.codec.restore
    vi.spyOn(this.codec, 'prepare').mockImplementation(async (message, context) => {
      /** One public operation's starting count excludes previous captures and handshakes. */
      const before = this.digests.length
      try {
        return await Reflect.apply(prepare, this.codec, [message, context])
      } finally {
        this.steps.push({ stage: 'prepare', hashes: this.digests.length - before })
      }
    })
    vi.spyOn(this.codec, 'restore').mockImplementation(async (message, context) => {
      /** Receiver verification must count separately even when restoration rejects. */
      const before = this.digests.length
      try {
        return await Reflect.apply(restore, this.codec, [message, context])
      } catch (error) {
        this.restoreFailures.push(error)
        throw error
      } finally {
        this.steps.push({ stage: 'restore', hashes: this.digests.length - before })
      }
    })
  }
}

/** One existing memory connection owns both public Hosts and exposes only actual codec/IO facts. */
class BinaryIntegrityPair {
  /** Each physical endpoint receives one independently observed actual JSON codec. */
  readonly codecs: BinaryCodecObservation[] = []
  /** Only actual provider dispatch records a successful restoration. */
  readonly delivered: unknown[] = []
  /** Physical output proves sidecar selection independently of MemoryCarrier's non-detaching IO. */
  readonly writes: Array<{ frame: IRpcCarrierFrame; transfer?: readonly ArrayBuffer[] }> = []
  /** The original receiver diagnostic releases a hostile-input assertion without a timer. */
  failure = deferred<unknown>()
  /** Corrupt signed inline metadata after its actual HMAC has already been computed. */
  tamperInline = false
  /** Corrupt an invisible native backing byte after sender capture and before real delivery. */
  tamperBacking = false
  /** Valid cryptographic inputs distinguish backing rejection from signature rejection. */
  verifies = 0
  /** Cold listener metadata reuses the existing native connection fixture. */
  readonly #listener
  /** Host shutdown owns all pending call, Session and codec cleanup. */
  #server: IRpcHost | undefined
  /** Only the committed client can originate a request. */
  #client: IRpcHost | undefined

  /** Install no additional carrier, transport, registry or alternate binary codec. */
  constructor() {
    this.#listener = coreMemoryServer('a33-server', 'a33-server', 'memory', [], [], {
      nativeBinary: true,
      create: () => {
        /** Both endpoints execute original public codec operations independently. */
        const observation = new BinaryCodecObservation()
        this.codecs.push(observation)
        return observation.codec
      }
    })
  }

  /** HMAC covers the complete original binding, including inline data and native digest rows. */
  #signature(value: unknown): string {
    return createHmac('sha256', signingKey).update(JSON.stringify(value)).digest('hex')
  }

  /** A hostile fixture changes only an actual signed backing row after the signature is fixed. */
  readonly #sign = (value: unknown) => {
    /** The actual callback value, rather than reconstructed metadata, supplies the signature. */
    const signature = this.#signature(value)
    if (!this.tamperInline) return { value, signature }
    /** Copy the genuine callback input so immutable prepared metadata remains caller-owned. */
    const changed = structuredClone(value) as {
      payload: { backings?: Array<{ data?: string }> }
    }
    /** Only a signed inline binary request carries this row after readiness. */
    const backing = changed.payload.backings?.[0]
    if (typeof backing?.data !== 'string') return { value, signature }
    backing.data = (backing.data[0] === 'A' ? 'B' : 'A') + backing.data.slice(1)
    return { value: changed, signature }
  }

  /** Verification precedes native restoration and preserves the original cryptographic failure. */
  readonly #verify = (input: unknown): unknown => {
    /** The counterpart signer is the only producer of this test representation. */
    const signed = input as { value: unknown; signature: string }
    if (signed.signature !== this.#signature(signed.value))
      throw new Error('A33 fixture signature mismatch')
    this.verifies++
    return signed.value
  }

  /** Public Auth factories and original transport installs establish real accepted readiness. */
  async open(signed: boolean): Promise<void> {
    /** Each actual Host installs its independent Auth lifetime when integrity is requested. */
    const plugins = signed ? [auth({ sign: this.#sign, verify: this.#verify })] : []
    this.#server = await createRpcHost({
      ...this.#listener.options,
      plugins: [...plugins, this.#listener.transport],
      report: (error) => this.failure.resolve(error),
      provide: {
        echo: (value) => {
          this.delivered.push(value)
          return value
        }
      }
    })
    /** A distinct Auth definition keeps replay state owned by the actual connecting Host. */
    const connected = await this.#listener.connect('a33-client', {
      plugins: signed ? [auth({ sign: this.#sign, verify: this.#verify })] : []
    })
    this.#client = connected.host
    /** This is the client's actual physical write, after codec capture and Auth transformation. */
    const original = connected.pair[1].write
    vi.spyOn(connected.pair[1], 'write').mockImplementation((frame, options) => {
      this.writes.push({ frame, transfer: options?.transfer })
      if (this.tamperBacking && frame.sidecars?.length) {
        expect(frame.sidecars).toHaveLength(1)
        new Uint8Array(frame.sidecars![0]!)[0] ^= 1
      }
      return original(frame, options)
    })
    this.reset()
  }

  /** Clear only observation receipts; native readiness, replay counters and providers stay live. */
  reset(): void {
    for (const codec of this.codecs) {
      codec.digests.length = 0
      codec.steps.length = 0
      codec.restoreFailures.length = 0
    }
    this.writes.length = 0
    this.verifies = 0
    this.failure = deferred<unknown>()
  }

  /** An explicit transfer intent crosses the original public call and physical filtering owner. */
  send(value: IRpcPortableValue, transfer: readonly ArrayBuffer[]): Promise<unknown> {
    return this.#client!.memory.send('a33-server', 'echo', value, { transfer, timeout: false })
  }

  /** Expose only completed real codec operations containing an actual SHA invocation. */
  hashedSteps() {
    return this.codecs.flatMap((codec) => codec.steps.filter((step) => step.hashes !== 0))
  }

  /** Native shutdown settles hostile requests through the original owners rather than a timer. */
  async close(): Promise<void> {
    await Promise.all([this.#client?.close(), this.#server?.close()])
  }
}

it('unsigned native bytes preserve actual transfer and execute zero SHA-256 calls', async () => {
  /** Ordinary unsigned native storage retains caller-owned complete backing identity. */
  const bytes = new Uint8Array([7, 8, 9])
  /** One public connection exercises both prepare and restore on request and echo. */
  const pair = new BinaryIntegrityPair()
  try {
    await pair.open(false)
    expect(await pair.send(bytes, [bytes.buffer])).toEqual(bytes)
    expect(pair.codecs.flatMap((codec) => codec.digests)).toEqual([])
    expect(pair.writes[0]!.frame.sidecars).toEqual([bytes.buffer])
    expect(pair.writes[0]!.transfer).toEqual([bytes.buffer])
    expect(pair.delivered).toEqual([bytes])
  } finally {
    await pair.close()
  }
})

it('explicit signed transfer keeps a small backing native while an ungranted echo is inline', async () => {
  /** The three-byte caller grant must retain original native handoff instead of copying inline. */
  const bytes = new Uint8Array([7, 8, 9])
  /** The echo has no return transfer grant and therefore uses the signed small-backing policy. */
  const pair = new BinaryIntegrityPair()
  try {
    await pair.open(true)
    expect(await pair.send(bytes, [bytes.buffer])).toEqual(bytes)
    expect(pair.writes[0]!.frame.sidecars).toEqual([bytes.buffer])
    expect(pair.writes[0]!.transfer).toEqual([bytes.buffer])
    expect(pair.hashedSteps().map((step) => step.hashes)).toEqual([1, 1])
    expect(pair.hashedSteps().filter((step) => step.stage === 'prepare')).toHaveLength(1)
    expect(pair.hashedSteps().filter((step) => step.stage === 'restore')).toHaveLength(1)
    expect(pair.delivered).toEqual([bytes])
  } finally {
    await pair.close()
  }
})

it.each([1125, 1126])(
  'signed whole-backing boundary %i preserves bytes and rejects actual wire tampering',
  async (size) => {
    /** A tiny view leaves byte zero invisible while the complete backing selects storage policy. */
    const bytes = new Uint8Array(size)
    bytes.set([9, 7, 8])
    /** Offset and hidden bytes must survive signed inline and native policies alike. */
    const view = new Uint8Array(bytes.buffer, 1, 2)
    /** Both boundary sides use the exact same actual public Auth and JSON codec owners. */
    const pair = new BinaryIntegrityPair()
    try {
      await pair.open(true)
      /** The actual echo performs two prepares and two restores, not one global digest operation. */
      const restored = (await pair.send(view, [])) as Uint8Array
      expect(restored).toEqual(view)
      expect(restored.byteOffset).toBe(1)
      expect(restored.buffer.byteLength).toBe(size)
      expect(new Uint8Array(restored.buffer)[0]).toBe(9)
      expect(pair.hashedSteps()).toHaveLength(size === 1125 ? 0 : 4)
      expect(pair.hashedSteps().map((step) => step.hashes)).toEqual(
        size === 1125 ? [] : [1, 1, 1, 1]
      )
      expect(pair.hashedSteps().filter((step) => step.stage === 'prepare')).toHaveLength(
        size === 1125 ? 0 : 2
      )
      expect(pair.hashedSteps().filter((step) => step.stage === 'restore')).toHaveLength(
        size === 1125 ? 0 : 2
      )
      expect(pair.writes[0]!.frame.sidecars ?? []).toEqual(size === 1125 ? [] : [bytes.buffer])
      expect(pair.writes[0]!.transfer ?? []).toEqual([])
      expect(bytes.buffer.byteLength).toBe(size)
      pair.reset()
      pair.tamperInline = size === 1125
      pair.tamperBacking = size === 1126
      /** Immediate rejection observation retains the actual pending caller until native shutdown. */
      const pending = pair.send(view, []).catch((error: unknown) => error)
      /** Verification or restore must reject before the genuine provider enters a second time. */
      const reported = await pair.failure.promise
      if (size === 1125) expect(reported).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      else {
        /** Accepted-channel protocol classification keeps the exact underlying integrity error. */
        const originals = pair.codecs.flatMap((codec) => codec.restoreFailures)
        expect(originals).toHaveLength(1)
        expect(originals[0]).toBeInstanceOf(TypeError)
        expect(originals[0]).toMatchObject({ code: RpcContractErrorCode.invalidEnvelope })
        expect(reported).toBeInstanceOf(RpcProtocolError)
        expect(reported).toMatchObject({ code: RpcCoreErrorCode.protocolInvalid })
        expect((reported as Error).cause).toBe(originals[0])
      }
      expect(pair.delivered).toHaveLength(1)
      expect(pair.verifies).toBe(size === 1125 ? 0 : 1)
      expect(pair.hashedSteps().map((step) => step.hashes)).toEqual(size === 1125 ? [] : [1, 1])
      await pair.close()
      expect(await pending).toBeInstanceOf(Error)
    } finally {
      await pair.close()
    }
  }
)

it('mixed logical backings retain aliases and transfer only the actual large sidecar subset', async () => {
  /** Small signed storage remains inline when the caller grants no ownership handoff for it. */
  const small = new Uint8Array([1, 2]).buffer
  /** Two aliases and a tiny final-byte view all borrow this one complete native backing. */
  const large = new Uint8Array(1126)
  large.set([9, 7, 8])
  large[large.length - 1] = 5
  /** Distinct logical backing rows must not renumber the shared native view references. */
  const payload = {
    small,
    large: large.buffer,
    first: new Uint8Array(large.buffer, 1, 2),
    second: new Uint8Array(large.buffer, 2, 1),
    tiny: new Uint8Array(large.buffer, large.length - 1, 1)
  }
  /** The sole public connection keeps native acquisition and shutdown unchanged. */
  const pair = new BinaryIntegrityPair()
  try {
    await pair.open(true)
    /** The explicit large handoff leaves the small copied backing eligible for signed inline. */
    const restored = (await pair.send(payload, [large.buffer])) as typeof payload
    expect(restored).toEqual(payload)
    expect(restored.first.buffer).toBe(restored.large)
    expect(restored.second.buffer).toBe(restored.large)
    expect(restored.tiny.buffer).toBe(restored.large)
    expect(restored.first.byteOffset).toBe(1)
    expect(restored.second.byteOffset).toBe(2)
    expect(restored.tiny.byteOffset).toBe(1125)
    expect(pair.writes[0]!.frame.sidecars).toEqual([large.buffer])
    expect(pair.writes[0]!.transfer).toEqual([large.buffer])
    expect(small.byteLength).toBe(2)
    expect(pair.hashedSteps()).toHaveLength(4)
    expect(pair.hashedSteps().map((step) => step.hashes)).toEqual([1, 1, 1, 1])
  } finally {
    await pair.close()
  }
})
