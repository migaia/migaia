import { expect, it } from 'vitest'
import type { IRpcDispatchContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcEnvelope, IRpcOutcome } from '@migaia/rpc-contract/protocol'
import { RpcWireProfile } from '@migaia/rpc-contract/protocol'
import { idempotency, createRpcIdempotencyStore } from '../../../dist/plugins/idempotency/index.js'
import { readRpcDefinition } from '../../../dist/sdk/metadata.js'
import { FlowPipeline } from '../../../dist/flow/pipeline.js'

it('actual optional idempotency dispatch observes sealed outcome and publishes only the native namespace lookup', async () => {
  /** The original store owns the only claim/seal/retention records. */
  const store = createRpcIdempotencyStore({ maxEntries: 1 })
  /**
   * This custom actual caller scope is the original public callback, independent from business
   * body.
   */
  const token = 'actual-admitted-scope'
  /** Native factory metadata is genuine, rather than an invented hook installation. */
  const metadata = readRpcDefinition(
    idempotency({ store, namespaces: ['test'], scope: () => token })
  )
  if (metadata?.kind !== 'flow') throw new TypeError('expected actual idempotency flow')
  /** Installation owns its exact ordinary cleanup signal. */
  const setup = new AbortController()
  /** Namespace lookup must originate a normal call through this existing host port. */
  const calls: unknown[] = []
  /** Setup contributes only the exact native plugin hooks and namespace publication. */
  const installation = await metadata.definition.setup({
    signal: setup.signal,
    report: () => undefined,
    retire: async () => undefined,
    call: async (namespace, command, options) => {
      calls.push({ namespace, command, options })
      return 'remote-outcome'
    }
  })
  /** Query dispatch uses the actual fixed slot, without executing another provider or claim path. */
  const flow = new FlowPipeline(() => undefined)
  flow.register({
    name: metadata.definition.name,
    namespaces: metadata.definition.namespaces,
    ...installation
  })
  flow.start()
  /** This selected generation was already admitted by the real Dispatcher before plugin dispatch. */
  const generation = { kind: 'session', value: 1, providerId: 'target-provider' } as const
  /**
   * Existing retained wire completion is replayed without rebuilding a native error or business
   * value.
   */
  const outcome: IRpcOutcome = {
    mode: 'request',
    targetGeneration: generation,
    completion: { ok: true, result: 42 }
  }
  /**
   * This is the same exact logical-provider/admitted-direct-caller scope used by the migrated
   * owner.
   */
  const scope = JSON.stringify([RpcWireProfile, generation.providerId, token])
  /** The real original claim entrance remains present and retains its string fingerprint ABI. */
  const claim = store.claim(scope, 'key', performance.now(), 'original-fingerprint')
  if (claim.status !== 'claimed') throw new TypeError('expected original claim ownership')
  claim.settle({ ok: true, data: outcome as never }, performance.now())
  /** Query has its own correlation, preserving the original selected caller/target tuple. */
  const envelope: IRpcEnvelope = {
    profile: RpcWireProfile,
    kind: 'outcome',
    operation: 'lookup',
    idempotencyKey: 'key',
    id: 'query',
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      receiverId: 'target',
      targetId: 'target',
      sentAt: 0
    },
    task: {
      mode: 'outcome',
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },
      targetGeneration: generation
    }
  }
  /** Original query completion belongs to Dispatcher; lookup does not create business execution. */
  const context: IRpcDispatchContext = {
    namespace: 'test',
    carrierId: 'source',
    direction: 'inbound',
    signal: setup.signal,
    connectionSignal: setup.signal,
    report: () => undefined,
    envelope,
    completion: Promise.resolve({ ok: true }),
    started: () => 0
  }
  /** Count only the actual fallback, not an invented provider registry. */
  let fallbacks = 0
  /** The installed owner must short-circuit before the ordinary unsupported/provider terminal. */
  const result = await flow.dispatch(context, async () => {
    fallbacks += 1
    return { kind: 'value', value: 'unexpected-provider' }
  })
  expect(result).toEqual({
    kind: 'value',
    value: {
      state: 'done',
      store: { kind: 'memory', epoch: expect.any(String), continuity: 'retained' },
      outcome
    }
  })
  expect(fallbacks).toBe(0)
  expect(store.claim(scope, 'another', performance.now()).status).toBe('full')
  /** The only public method is the actual plugin-host namespace extension. */
  const extension = installation.namespaceExtensions?.('test') as {
    outcome(key: string): Promise<unknown>
  }
  expect(await extension.outcome('remote-key')).toBe('remote-outcome')
  expect(calls).toEqual([
    {
      namespace: 'test',
      command: { mode: 'outcome', idempotencyKey: 'remote-key' },
      options: undefined
    }
  ])
  /** Existing scope compilation prevents this owner from adding query behavior to another namespace. */
  expect(
    await flow.dispatch({ ...context, namespace: 'other' }, async () => ({
      kind: 'value',
      value: 'other'
    }))
  ).toEqual({ kind: 'value', value: 'other' })
  await installation.dispose?.()
  await installation.dispose?.()
  flow.close()
})
