/** A29 exercises Auth callback representations through public Hosts and the original memory medium. */
import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { auth, type IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'
import { createRpcBackingDigest, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { coreMemoryServer } from '../../host/core-fixture.js'

/** The original A12 fixture uses this public key with SHA-256 over JSON.stringify(value). */
const signingKey = 'core-refactor-public-fixture-key'

/** Only this test's real signer produces the value/signature pair consumed by its verifier. */
type ISignedBinding = Readonly<{ value: unknown; signature: string }>
/** Auth's binding keeps the prepared metadata as an object in all supported callback categories. */
type IBinding = Readonly<{ version: number; payload: object }>

/** Reuse the original fixture algorithm without importing or executing its benchmark driver. */
function signature(value: unknown): string {
  return createHmac('sha256', signingKey).update(JSON.stringify(value)).digest('hex')
}

/** User normalization signs the complete callback value, including nonce, counter and payload. */
function signBinding(value: unknown): ISignedBinding {
  return { value, signature: signature(value) }
}

/** A changed binding fails cryptographic verification before semantic restoration or provider entry. */
function verifyBinding(value: unknown): unknown {
  /** The public signer is the sole producer of this fixture's protected representation. */
  const signed = value as ISignedBinding
  if (signed.signature !== signature(signed.value))
    throw new Error('A29 fixture signature mismatch')
  return signed.value
}

/** Own exactly two genuine public Hosts; representation observation remains in user callbacks. */
class PublicAuthenticationPair {
  /** Every pair uses the existing listener and canonical JSON codec, with explicit native storage. */
  readonly #listener
  /** Host cleanup remains with the actual public owners, including partially opened pairs. */
  #server: IRpcHost | undefined
  /** Only a committed client namespace may originate the business request. */
  #client: IRpcHost | undefined
  /** Actual provider delivery distinguishes admitted traffic from rejected signed metadata. */
  readonly delivered: unknown[] = []

  /** Configure the original medium without a new carrier, runner or protocol fixture. */
  constructor(nativeBinary = false) {
    this.#listener = coreMemoryServer('a29-server', 'a29-server', 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec({ digest: createRpcBackingDigest() }),
      nativeBinary
    })
  }

  /** Both native Auth installations run through their public factories before accepted readiness. */
  async open(client: IRpcAuthenticationOptions, server: IRpcAuthenticationOptions): Promise<void> {
    this.#server = await createRpcHost({
      ...this.#listener.options,
      plugins: [auth(server), this.#listener.transport],
      provide: {
        echo: (value: unknown) => {
          this.delivered.push(value)
          return value
        }
      }
    })
    /** The existing listener connects both real Session owners and awaits their original handshakes. */
    const connected = await this.#listener.connect('a29-client', { plugins: [auth(client)] })
    this.#client = connected.host
  }

  /**
   * The actual public namespace performs provider discovery, Auth, native IO and result
   * restoration.
   */
  echo(value: IRpcPortableValue): Promise<unknown> {
    return this.#client!.memory.send('a29-server', 'echo', value)
  }

  /** Native owners release their own Session, codec and Auth resources even after failed opening. */
  async close(): Promise<void> {
    await Promise.all([this.#client?.close(), this.#server?.close()])
  }
}

// BC16 A: default object signing and the unchanged original native-object path.
it('A29 signs default any bindings and object payloads with the original HMAC algorithm', async () => {
  // These two storage modes are the fixed inline/native domain exercised by this public case.
  for (const nativeBinary of [false, true]) {
    /** Capture only client sign inputs and their counterpart server verification outputs. */
    const signed: unknown[] = []
    /** Restored values come from the real codec before the receiver's user verifier returns them. */
    const verified: unknown[] = []
    /** Both storage paths use the same ordinary public host construction and call. */
    const pair = new PublicAuthenticationPair(nativeBinary)
    try {
      await pair.open(
        {
          sign: (value) => {
            signed.push(value)
            return signBinding(value)
          },
          verify: verifyBinding
        },
        {
          sign: signBinding,
          verify: (value) => {
            /** Verification compares the original complete binding after actual wire restoration. */
            const binding = verifyBinding(value)
            verified.push(binding)
            return binding
          }
        }
      )
      /** Binary application data proves that native storage still uses the original object path. */
      const payload = { label: 'A29 roundtrip', bytes: new Uint8Array([0, 17, 255]) }
      expect(await pair.echo(payload)).toEqual(payload)
      /** This final client signature belongs to the completed public request, before cleanup. */
      const binding = signed.at(-1) as IBinding
      expect(binding).toBeTypeOf('object')
      expect(binding.payload).toBeTypeOf('object')
      expect(Array.isArray(binding.payload)).toBe(false)
      expect(verified).toContainEqual(binding)
      expect(pair.delivered).toEqual([payload])
    } finally {
      await pair.close()
    }
  }
})

it('A29 rejects a changed default binding in verify before public provider delivery', async () => {
  /** The existing native admission path sees this exact original verifier failure. */
  const failures: unknown[] = []
  /** No private emitter or alternate codec injects the changed signed object. */
  const pair = new PublicAuthenticationPair()
  try {
    await expect(
      pair.open(
        {
          sign: (value) => {
            /** Mutate only after signing so the receiver must detect a changed binding field. */
            const signed = signBinding(value)
            /** A normal Auth binding version is authenticated together with its complete payload. */
            const binding = value as IBinding
            return { ...signed, value: { ...binding, version: binding.version + 1 } }
          },
          verify: verifyBinding
        },
        {
          sign: signBinding,
          verify: (value) => {
            try {
              return verifyBinding(value)
            } catch (error) {
              failures.push(error)
              throw error
            }
          }
        }
      )
    ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'AUTHENTICATION_FAILED' })
    expect(failures).not.toHaveLength(0)
    expect(failures[0]).toMatchObject({ message: 'A29 fixture signature mismatch' })
    expect(pair.delivered).toEqual([])
  } finally {
    await pair.close()
  }
})
