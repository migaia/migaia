import { assert, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { batch } from '@migaia/rpc-host/plugins/batch'
import {
  defineFlowFeature,
  RpcFlowPoint,
  RpcJsonCarrierCodec,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import {
  RPC_CORE_ERROR_SOURCE,
  RpcAuthenticationError,
  RpcError
} from '@migaia/rpc-contract/errors'
import {
  IpcSendClass,
  type IRpcCarrierFrame,
  type IRpcFlowContext
} from '@migaia/rpc-contract/interfaces'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { createRpcAuthenticationError } from '../../../dist/host/error-owner.js'
import { RpcBatchExtension } from '../../../dist/features/batch/constants.js'

it('hostile outbound authentication preserves native source/code/cause identity', async () => {
  /** The exact original callback failure must remain the public authentication error's cause. */
  const hostile = new Error('outbound encrypt failed')
  /** Canonical v2 negotiation completes before the original business-write failure is armed. */
  const state = { armed: false }
  /** Both original physical endpoints borrow the executing SDK JSON codec, without a new codec. */
  const listener = coreMemoryServer('target', 'target', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The actual remote directory advertises the original target method through the public Host. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [auth({ sign: (value) => value, verify: (value) => value }), listener.transport],
    provide: { method: (value) => value }
  })
  try {
    /** The public auth plugin owns the original throwing encrypt callback and its error boundary. */
    const client = await listener.connect('hostile-auth-client', {
      plugins: [
        auth({
          encrypt: (value) => {
            if (state.armed) throw hostile
            return value
          },
          decrypt: (value) => value,
          sign: (value) => value,
          verify: (value) => value
        })
      ]
    })
    try {
      state.armed = true
      /** One real request reaches prepare, the installed auth hook and the actual local failure. */
      const pending = client.host.memory.send('target', 'method', 'data', { timeout: false })
      await expect(pending).rejects.toMatchObject({
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.authenticationFailed,
        cause: hostile
      })
      /** Preserve native object identity rather than merely comparing a serialized error shape. */
      const failure = await pending.catch((error: unknown) => error)
      expect((failure as Error).cause).toBe(hostile)
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})

it.each(['throws synchronously', 'rejects asynchronously', 'returns an invalid encoded value'])(
  'classifies original outbound authentication that %s before any physical write',
  async (label) => {
    /** The original throwing and rejecting callbacks must retain this exact causal Error. */
    const cause = new Error(`authentication ${label}`)
    /** Real bilateral ready completes before the original one-shot business failure is armed. */
    const state = { armed: false }
    /** The actual JSON media codec supplies strings to the installed explicit-string transform. */
    const listener = coreMemoryServer('outbound-auth-provider', undefined, 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    /** The peer owns normal authentication and its genuine public method directory. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [
        auth({ encodedType: 'string', sign: (value) => value, verify: (value) => value }),
        listener.transport
      ],
      provide: { read: () => 42 }
    })
    try {
      /** Only the public authentication plugin executes the original protect failure conditions. */
      const client = await listener.connect('outbound-auth-client', {
        plugins: [
          auth({
            encodedType: 'string',
            sign: (value) => {
              if (!state.armed) return value
              if (label === 'throws synchronously') throw cause
              if (label === 'rejects asynchronously') return Promise.reject(cause)
              return 42
            },
            verify: (value) => value
          })
        ]
      })
      /** The actual client sender remains a passthrough spy after normal handshake traffic. */
      const writing = vi.spyOn(client.pair[1], 'write')
      try {
        state.armed = true
        /** Namespace request observes the auth failure before the original codec/native handoff. */
        const thrown = await client.host.memory.request('read').then(
          () => undefined,
          (error: unknown) => error
        )
        expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
        if (label !== 'returns an invalid encoded value')
          expect((thrown as { cause: unknown }).cause).toBe(cause)
        expect(writing).toHaveBeenCalledTimes(0)
      } finally {
        state.armed = false
        writing.mockRestore()
        await client.host.close()
      }
    } finally {
      await server.close()
    }
  }
)

it('keeps the original locally owned authentication failure identity through a public request', async () => {
  /**
   * Reuse the original canonical factory input; the public constructor does not mint local
   * ownership.
   */
  const authenticationError = createRpcAuthenticationError('authentication failure')
  /** Only the original business protect callback rejects, after real handshake admission. */
  const state = { armed: false }
  /** The existing JSON codec and native fixture retain the same ordinary physical connection. */
  const listener = coreMemoryServer('owned-auth-provider', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The peer installs the same real authentication flow and public method directory. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [auth({ sign: (value) => value, verify: (value) => value }), listener.transport],
    provide: { read: () => 42 }
  })
  try {
    /** Original factory-minted Error enters the real public hook rather than a private sender call. */
    const client = await listener.connect('owned-auth-client', {
      plugins: [
        auth({
          sign: (value) => (state.armed ? Promise.reject(authenticationError) : value),
          verify: (value) => value
        })
      ]
    })
    try {
      state.armed = true
      /** Preserve the exact original code and Error identity, without constructing a second failure. */
      const thrown = await client.host.memory.request('read').then(
        () => undefined,
        (error: unknown) => error
      )
      expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      expect(thrown).toBe(authenticationError)
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})

it('preserves the original authentication configuration getter cause at the public factory', () => {
  /** The original unreadable configuration throws this same caller-owned Error on its first read. */
  const hostile = new Error('authentication hostile config getter')
  /** The supported public factory must classify an unreadable options object without losing cause. */
  const config = new Proxy(
    {},
    {
      get() {
        throw hostile
      }
    }
  )
  /** Configuration capture now runs at the public factory rather than inside an old native role. */
  let primary: unknown
  try {
    auth(config as never)
  } catch (error) {
    primary = error
  }
  expect(primary).toBeInstanceOf(RpcError)
  expect(primary).toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
  expect((primary as Error).cause).toBe(hostile)
  expect(walkErrorCauses(primary).includes(hostile)).toBe(true)
})

it('preserves the original inbound decrypt failure through the public authentication report', async () => {
  /** This exact original callback failure must survive the actual inbound authentication boundary. */
  const hostile = new Error('authentication unprotect hostile transform')
  /** Genuine ready handshakes finish before the application decrypt failure is armed. */
  const state = { armed: false }
  /** The public reporter supplies a barrier for this original native failure, without fixed sleeps. */
  const observed = deferred<unknown>()
  /** Both real endpoints use the existing executing JSON codec and physical MemoryCarrier pair. */
  const listener = coreMemoryServer('inbound-auth-provider', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The public Auth plugin owns verification, decryption and the resulting classified failure. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      auth({
        encrypt: (value) => value,
        sign: (value) => value,
        verify: (value) => value,
        decrypt: (value) => {
          if (state.armed) throw hostile
          return value
        }
      }),
      listener.transport
    ],
    provide: { read: () => 42 },
    report: (error) => {
      if (walkErrorCauses(error).includes(hostile)) observed.resolve(error)
    }
  })
  try {
    /** A normal authenticated caller supplies genuine protected metadata to the failing decryptor. */
    const client = await listener.connect('inbound-auth-client', {
      plugins: [auth({ sign: (value) => value, verify: (value) => value })]
    })
    try {
      state.armed = true
      /** Observe caller settlement while the public reporter retains the original hook failure. */
      const pending = client.host.memory
        .send('inbound-auth-provider', 'read', null, {
          timeout: false
        })
        .catch((error: unknown) => error)
      /** Inbound pre-admission rejection is reported without inventing an authenticated reply. */
      const failure = await observed.promise
      expect(failure).toMatchObject({ code: 'AUTHENTICATION_FAILED', cause: hostile })
      expect(walkErrorCauses(failure).includes(hostile)).toBe(true)
      /** A dropped unauthenticated input has no reply; join its caller only after real cleanup. */
      await client.host.close()
      await pending
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})

it('isolates a public signing failure while the native batch writer is busy and recovers later calls', async () => {
  /** The selected original user transform failure remains the public classified failure's cause. */
  const cause = new Error('fixture queued protection failure')
  /** Only the next actual envelope fails; later protection keeps its original executing owner. */
  const state = { failNext: false }
  /** Real provider effects identify delivered traffic without decoding physical frames again. */
  const calls: string[] = []
  /** Both native endpoints use the existing JSON codec before their genuine physical Batch owner. */
  const listener = coreMemoryServer('busy-auth-provider', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The original receiving Auth/Batch installations own their nonce, replay and physical state. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      auth({ encodedType: 'string', sign: (value) => value, verify: (value) => value }),
      batch(),
      listener.transport
    ],
    provide: {
      echo: (value: string) => {
        calls.push(value)
        return value
      }
    }
  })
  try {
    /** Real handshakes complete before the selected per-envelope signing rejection is armed. */
    const client = await listener.connect('busy-auth-client', {
      plugins: [
        auth({
          encodedType: 'string',
          sign: (value) => {
            if (!state.failNext) return value
            state.failNext = false
            return Promise.reject(cause)
          },
          verify: (value) => value
        }),
        batch()
      ]
    })
    /** Existing native write facts exclude directory/control traffic without inspecting ciphertext. */
    const output = { send: client.pair[1].write, frames: [] as IRpcCarrierFrame[] }
    /** This passthrough preserves the real MemoryCarrier write gate and exact physical frame. */
    const writing = vi.spyOn(client.pair[1], 'write').mockImplementation((frame, options) => {
      if (options?.sendClass === IpcSendClass.data) output.frames.push(frame)
      return output.send(frame, options)
    })
    /** Original caller operations are joined during cleanup if a later business assertion fails. */
    const pending: Promise<unknown>[] = []
    try {
      client.pair[1].holdWrites()
      /** The first genuine public call reaches the real native writer and remains physically held. */
      const first = client.host.memory
        .send('busy-auth-provider', 'echo', 'first')
        .catch((error: unknown) => error)
      pending.push(first)
      await vi.waitFor(() => expect(output.frames).toHaveLength(1))
      state.failNext = true
      /** Current Auth protects this envelope before Batch, so its failure owns only this call. */
      const failure = await client.host.memory
        .send('busy-auth-provider', 'echo', 'failed')
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RpcAuthenticationError)
      expect(failure).toMatchObject({
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.authenticationFailed,
        cause
      })
      expect((failure as Error).cause).toBe(cause)
      expect(output.frames).toHaveLength(1)
      expect(calls).toEqual([])
      /** A later real request is submitted while that same original physical writer is still held. */
      const boundary = client.host.memory
        .send('busy-auth-provider', 'echo', 'boundary')
        .catch((error: unknown) => error)
      pending.push(boundary)
      client.pair[1].releaseWrites()
      expect(await first).toBe('first')
      expect(await boundary).toBe('boundary')
      expect(calls).toEqual(['first', 'boundary'])
      expect(output.frames).toHaveLength(2)
      /** The same public namespace, Auth instance and physical source remain usable after failure. */
      expect(await client.host.memory.send('busy-auth-provider', 'echo', 'recovered')).toBe(
        'recovered'
      )
      expect(calls).toEqual(['first', 'boundary', 'recovered'])
      expect(output.frames).toHaveLength(3)
    } finally {
      state.failNext = false
      client.pair[1].releaseWrites()
      writing.mockRestore()
      await client.host.close()
      await Promise.all(pending)
    }
  } finally {
    await server.close()
  }
})

it('coalesces two separately authenticated public calls on the same actual source after a held write', async () => {
  /** Actual public providers retain all three original logical values in native delivery order. */
  const calls: string[] = []
  /** This bounded witness observes actual sign entries and frames without parsing protected text. */
  const observation = {
    enabled: false,
    contexts: [] as IRpcFlowContext[],
    frames: [] as IRpcCarrierFrame[],
    entered: deferred<void>()
  }
  /** The genuine frame stage forwards first, so the native Batch owner owns each queued input. */
  const observeFrame: IRpcFlowStage<'frameOutbound'> = (payload, next) => {
    /** This is the original native continuation, never a second stage runner or IO queue. */
    const traversal = next(payload)
    if (observation.enabled && payload.frame.kind === RpcCarrierFrameKind.message) {
      observation.frames.push(payload.frame)
      if (observation.frames.length === 3) observation.entered.resolve()
    }
    return traversal
  }
  /** Actual native setup publishes the original named callback without another closure backbone. */
  const witness = defineFlowFeature({
    name: 'authenticated-batch-member-witness',
    setup: () => ({ stages: { [RpcFlowPoint.frameOutbound]: observeFrame } })
  })
  /** Both endpoints reuse the actual JSON codec and existing physical MemoryCarrier pair. */
  const listener = coreMemoryServer('authenticated-batch-provider', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Per-envelope Auth precedes the provider's physical Batch feature in the original pipelines. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      auth({ encodedType: 'string', sign: (value) => value, verify: (value) => value }),
      batch(),
      listener.transport
    ],
    provide: {
      echo: (value: string) => {
        calls.push(value)
        return value
      }
    }
  })
  try {
    /** The configured canonical signer returns the same actual input without a new group format. */
    const client = await listener.connect('authenticated-batch-client', {
      plugins: [
        auth({
          encodedType: 'string',
          sign: (value, context) => {
            if (observation.enabled) observation.contexts.push(context)
            return value
          },
          verify: (value) => value
        }),
        witness,
        batch()
      ]
    })
    /** Existing write facts distinguish actual data frames without decoding the signed payload. */
    const output = { send: client.pair[1].write, frames: [] as IRpcCarrierFrame[] }
    /** Preserve original write and gate ownership while retaining each real physical frame. */
    const writing = vi.spyOn(client.pair[1], 'write').mockImplementation((frame, options) => {
      if (options?.sendClass === IpcSendClass.data) output.frames.push(frame)
      return output.send(frame, options)
    })
    /** Every original caller settlement is observed immediately and joined during cleanup. */
    const pending: Promise<unknown>[] = []
    try {
      observation.enabled = true
      client.pair[1].holdWrites()
      /** The actual first native write supplies backpressure before the two separate later calls. */
      const first = client.host.memory
        .send('authenticated-batch-provider', 'echo', 'first')
        .catch((error: unknown) => error)
      pending.push(first)
      await vi.waitFor(() => expect(output.frames).toHaveLength(1))
      /** Each later public operation keeps its original task, signature and returned value. */
      const one = client.host.memory
        .send('authenticated-batch-provider', 'echo', 'one')
        .catch((error: unknown) => error)
      /** This distinct logical call enters the same existing physical source's Batch lane. */
      const two = client.host.memory
        .send('authenticated-batch-provider', 'echo', 'two')
        .catch((error: unknown) => error)
      pending.push(one, two)
      await observation.entered.promise
      expect(output.frames).toHaveLength(1)
      expect(calls).toEqual([])
      /** Current Auth signs all three envelopes independently; no old two-group count is required. */
      expect(observation.contexts).toHaveLength(3)
      for (const context of observation.contexts) {
        expect(context.namespace).toBe('memory')
        expect(context.carrierId).toBe(client.pair[1].id)
        expect(context.session?.peerId).toBe('authenticated-batch-provider')
      }
      client.pair[1].releaseWrites()
      expect(await Promise.all([first, one, two])).toEqual(['first', 'one', 'two'])
      expect(calls).toEqual(['first', 'one', 'two'])
      expect(output.frames).toHaveLength(2)
      /** The second physical frame is the original Batch extension over exactly two encoded members. */
      const aggregate = output.frames[1]
      expect(aggregate).toMatchObject({
        kind: RpcCarrierFrameKind.extension,
        extension: RpcBatchExtension,
        data: { frames: observation.frames.slice(1) }
      })
      assert(aggregate?.kind === RpcCarrierFrameKind.extension)
      /** Reading this owned outer frame does not parse or restore either opaque member string. */
      const members = Reflect.get(aggregate.data as object, 'frames') as IRpcCarrierFrame[]
      expect(members).toHaveLength(2)
      expect(members[0]).toBe(observation.frames[1])
      expect(members[1]).toBe(observation.frames[2])
    } finally {
      observation.enabled = false
      client.pair[1].releaseWrites()
      writing.mockRestore()
      await client.host.close()
      await Promise.all(pending)
    }
  } finally {
    await server.close()
  }
})
