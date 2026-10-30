import { expect, it } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import type { IRpcDispatchContext } from '@migaia/rpc-contract/interfaces'
import { RpcDispatchDrop } from '@migaia/rpc-contract/interfaces'
import type { IRpcEnvelope, IRpcOutcome } from '@migaia/rpc-contract/protocol'
import { RpcWireProfile } from '@migaia/rpc-contract/protocol'
import {
  idempotencyFeature,
  createRpcIdempotencyStore
} from '../../../dist/features/idempotency/index.js'
import { FlowRegistry, type IRpcFlowGroup } from '../../../dist/flow/registry.js'
import {
  rpcHostPipelines,
  rpcPipelineOwner,
  RpcFlowPoint,
  RpcFlowPipelines,
  type IRpcPipelineOwner
} from '../../../dist/sdk/flow-pipelines.js'
import { RpcTransportFlowProgram } from '../../../dist/sdk/flow-program.js'
import type { IRpcFlowInstallation } from '../../../dist/sdk/types.js'

it('actual optional idempotency dispatch observes sealed outcome and publishes only the native namespace lookup', async () => {
  /** The original store owns the only claim/seal/retention records. */
  const store = createRpcIdempotencyStore({ maxEntries: 1 })
  /**
   * This custom actual caller scope is the original public callback, independent from business
   * body.
   */
  const token = 'actual-admitted-scope'
  /** The native graph owns this real Feature and the original custom scope callback. */
  /** Scope is a plain configuration callback and receives no captured option receiver. */
  const scopeReceivers: unknown[] = []
  const feature = idempotencyFeature({
    store,
    scope(this: unknown) {
      scopeReceivers.push(this)
      return token
    }
  })
  /** The actual native installation owns its original setup signal. */
  const setup = new AbortController()
  /** Namespace lookup must originate a normal call through this existing host port. */
  const calls: unknown[] = []
  /** The genuine use() handoff supplies this exact setup result before any oracle runs. */
  let installation!: IRpcFlowInstallation<object>
  /** Actual native construction requests supply one execution port per installed group. */
  const owners = new Map<string, IRpcPipelineOwner>()
  /** Only prepared original groups contribute namespace facts to this fixture. */
  const groups = new Map<string, IRpcFlowGroup>()
  /** Canonical native Feature inspection owns the local setup and its dependency closure. */
  const program = new RpcTransportFlowProgram({ feature })
  /** Both actual namespace declarations use the same native owner lookup as public SDK hosts. */
  const rpc = rpcHostPipelines(
    () => flow,
    (name, request) => flow.pipeline(name, request)
  )
  /** Query dispatch uses the actual fixed slot, without executing another provider or claim path. */
  const flow = defineHost({
    domainCore(request) {
      /** The genuine native request fixes this registration's execution authority. */
      const domain = rpc.domainCore(request)
      owners.set(request.pluginName, domain[rpcPipelineOwner])
      return domain
    },
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Production registration borrows this genuine native install core and its generation. */
  const registry = new FlowRegistry(
    () => undefined,
    (namespace) => groups.get(namespace)
  )
  await flow.use(
    definePlugin({
      name: 'test',
      pipelines: RpcFlowPipelines,
      features: program.features,
      async install(core) {
        /** Canonical setup retains the original instance and its genuine native cleanup owner. */
        const group = await registry.prepareTransport(core, program, setup.signal, {
          signal: setup.signal,
          report: () => undefined,
          retire: async () => undefined,
          call: async (namespace, command, options) => {
            calls.push({ namespace, command, options })
            return 'remote-outcome'
          }
        })
        groups.set('test', group)
        installation = group.facts().selected[0]!
        return {}
      }
    })
  )
  /** The other namespace is a separate genuine native group with no selected Features. */
  const other = new RpcTransportFlowProgram()
  await flow.use(
    definePlugin({
      name: 'other',
      pipelines: RpcFlowPipelines,
      features: other.features,
      async install(core) {
        groups.set(
          'other',
          await registry.prepareTransport(core, other, setup.signal, {
            signal: setup.signal,
            report: () => undefined,
            retire: async () => undefined,
            call: async () => undefined
          })
        )
        return {}
      }
    })
  )
  registry.start()
  /** The same genuine owner retains each point payload axis while lending native execution. */
  const pipelines = owners.get('test')!
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
  const result = {
    value: RpcDispatchDrop as import('@migaia/rpc-contract/interfaces').IRpcDispatchOutcome
  }
  await pipelines
    .pipeline(RpcFlowPoint.dispatchInbound, 'test')
    .run({ context, outcome: result }, async (payload) => {
      fallbacks += 1
      payload.outcome.value = { kind: 'value', value: 'unexpected-provider' }
    })
  expect(result.value).toEqual({
    kind: 'value',
    value: {
      state: 'done',
      store: { kind: 'memory', epoch: expect.any(String), continuity: 'retained' },
      outcome
    }
  })
  expect(fallbacks).toBe(0)
  expect(scopeReceivers).toEqual([undefined])
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
  await owners
    .get('other')!
    .pipeline(RpcFlowPoint.dispatchInbound, 'other')
    .run({ context: { ...context, namespace: 'other' }, outcome: result }, async (payload) => {
      payload.outcome.value = { kind: 'value', value: 'other' }
    })
  expect(result.value).toEqual({ kind: 'value', value: 'other' })
  await installation.dispose?.()
  await installation.dispose?.()
  await flow.dispose()
})
