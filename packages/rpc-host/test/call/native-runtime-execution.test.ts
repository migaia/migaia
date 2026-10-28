/** Original completed-group retention survives failure at the genuine native terminal write. */
import { Session as InspectorSession } from 'node:inspector/promises'
import type { Runtime } from 'node:inspector'
import { createRpcHost } from '@migaia/rpc-host'
import {
  createRpcIdempotencyStore,
  idempotencyFeature,
  type IRpcIdempotencyClaim,
  type IRpcIdempotencyOutcome,
  type IRpcIdempotencyStore
} from '@migaia/rpc-host/plugins/idempotency'
import limits from '@migaia/rpc-host/plugins/limits'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import {
  RPC_ENDPOINT_ERROR_SOURCE,
  RpcContractErrorCode,
  RpcCoreErrorCode
} from '@migaia/rpc-contract/error-code'
import { RpcWireProfile, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcStreamEvent } from '@migaia/rpc-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { ProviderAdmissionRegistry } from '../../dist/features/limits/provider-admission.js'
import { ProviderDispatcher } from '../../dist/dispatch/dispatcher.js'
import { ProviderInvocation } from '../../dist/dispatch/invocation.js'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** In-process engine inspection retains only this case's genuine provider operation owner. */
const inspectorRoot = '__rpcKeyedGroupProvider'
/** Node exposes real private descriptors beyond its bundled protocol declarations. */
type IProperties = Runtime.GetPropertiesReturnType & {
  privateProperties?: readonly { name: string; value?: Runtime.RemoteObject }[]
}

/** Reuse fixed private-Map read for the actual replacement of the old controller registry. */
class IncomingInspector {
  /** In-process inspection opens no network listener and invokes no private owner method. */
  readonly #session = new InspectorSession()

  /** Keep the original dispatcher reference until its genuine final operation cleanup is sampled. */
  constructor(owner: ProviderDispatcher) {
    ;(globalThis as unknown as Record<string, unknown>)[inspectorRoot] = owner
    this.#session.connect()
  }

  /** An empty real source-to-operation Map proves there are no retained provider operations. */
  async pending(): Promise<number> {
    /** Only this fixed test-owned global reaches the original production dispatcher reference. */
    const owner = await this.#session.post('Runtime.evaluate', {
      expression: 'globalThis[' + JSON.stringify(inspectorRoot) + ']',
      objectGroup: inspectorRoot
    })
    if (owner.exceptionDetails || !owner.result.objectId)
      throw new Error('Keyed group provider is unavailable to the inspector')
    /** The engine exposes the original field rather than a computed or substituted diagnostic. */
    const properties: IProperties = await this.#session.post('Runtime.getProperties', {
      objectId: owner.result.objectId,
      ownProperties: true
    })
    /** This is the sole fixed production path read by the reused observation seam. */
    const incoming = properties.privateProperties?.find((field) => field.name === '#incoming')
    /** Missing descriptors must fail rather than becoming a fabricated empty table. */
    const size = /^Map\((\d+)\)$/u.exec(incoming?.value?.description ?? '')
    if (incoming?.value?.subtype !== 'map' || !size)
      throw new Error('Keyed group provider incoming Map is unavailable')
    return Number(size[1])
  }

  /** Release the exact engine object group and temporary owner reference even after failure. */
  async close(): Promise<void> {
    try {
      await this.#session.post('Runtime.releaseObjectGroup', { objectGroup: inspectorRoot })
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)[inspectorRoot]
      this.#session.disconnect()
    }
  }
}

/** The original custom-store boundary returns a real cloned retained body, without local brands. */
function cloneStoredStreamOutcome(
  outcome: IRpcIdempotencyOutcome | 'unavailable' | undefined
): IRpcIdempotencyOutcome | 'unavailable' | undefined {
  return structuredClone(outcome)
}

/** Delegate the sole real claim algorithm, then clone only its exposed retained outcome snapshots. */
function clonedStreamClaim(
  store: IRpcIdempotencyStore,
  scope: string,
  key: string,
  now: number,
  fingerprint?: string
): IRpcIdempotencyClaim {
  /** The original store alone grants execution, waits, rejects capacity or supplies a done body. */
  const claim = store.claim(scope, key, now, fingerprint)
  return claim.status === 'done'
    ? { status: 'done', outcome: structuredClone(claim.outcome) }
    : claim.status === 'pending'
      ? { status: 'pending', outcome: claim.outcome.then(cloneStoredStreamOutcome) }
      : claim
}

// All original retained-completion predicates remain unchanged.
it('a send adapter forged FRAME_LIMIT code cannot rewrite the original completed group replay outcome', async () => {
  /** The actual optional feature receives this original injectable memory store. */
  const store = createRpcIdempotencyStore()
  /** Real diagnostics retain the original native write failure and its cause identity. */
  const reports: unknown[] = []
  /** The authentic public provider supplies the same logical provider scope as the original test. */
  const server = coreMemoryServer('provider')
  /** This real provider alone creates the original completed business value42. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotencyFeature({ store, scope: () => 'peer' }), ...server.options.plugins],
    report: (error) => reports.push(error),
    provide: { value: (_payload, context) => context.success(42) }
  })
  /** The actual accepted caller invokes a group through its existing public namespace. */
  const client = await server.connect('caller')
  /** Publicly attached diagnostics cannot impersonate the contract owner's native failure. */
  const reason = attachErrorIdentity(new Error('adapter frame fixture'), {
    source: 'rpc.contract',
    code: RpcContractErrorCode.frameLimitExceeded
  })
  /** One explicit IO context borrows the genuine physical writer and records its refusal. */
  const terminal = {
    write: client.pair[0].write,
    reason,
    attempted: deferred<void>()
  }
  /** Only the original group terminal is refused; handshake and native cleanup keep real IO. */
  const failure = vi.spyOn(client.pair[0], 'write').mockImplementation((frame, options) => {
    /** The original identity medium already carries semantic metadata; no observer parser runs. */
    const message = frame.data as IRpcSemanticFrame
    if (message.kind === 'result' && message.task.mode === 'group') {
      terminal.attempted.resolve()
      return Promise.reject(terminal.reason)
    }
    return terminal.write(frame, options)
  })
  /** The missing physical reply keeps its original caller Promise pending until genuine close. */
  const pending = client.host.memory
    .group([{ method: 'value' }], { idempotencyKey: 'completed-key' })
    .catch((error: unknown) => error)
  try {
    await terminal.attempted.promise
    /** The actual response owner must finish reporting its failed write before retention is read. */
    await vi.waitFor(() =>
      expect(reports).toContainEqual(
        expect.objectContaining({ code: RpcCoreErrorCode.transport, cause: reason })
      )
    )
    /** Only the profile spelling changes; the real installed scope callback chooses the same peer. */
    const scope = JSON.stringify([RpcWireProfile, 'provider', 'peer'])
    /** Inspect the same authentic store after original business completion and terminal refusal. */
    const retained = store.lookup!(scope, 'completed-key', performance.now())
    assert.equal(retained.state, 'done')
    if (retained.state !== 'done' || retained.outcome === 'unavailable' || !retained.outcome.ok)
      assert.fail('completed outcome missing')
    /** Preserve the original null-prototype-compatible retained completion inspection. */
    const completion = Reflect.get(retained.outcome.data as object, 'completion') as {
      ok: boolean
      result: readonly { state: string; result: number }[]
    }
    assert.equal(completion.ok, true)
    assert.equal(completion.result.length, 1)
    assert.equal(completion.result[0]!.state, 'success')
    assert.equal(completion.result[0]!.result, 42)
  } finally {
    failure.mockRestore()
    await Promise.all([client.host.close(), host.close()])
    await pending
  }
})

// Real claims, leases and two original physical terminals are observed.
it('an original pending keyed claim prevents duplicate execution and seals the complete group before terminal send', async () => {
  /** Exactly this original production store owns both the first claim and its pending observer. */
  const originalStore = createRpcIdempotencyStore()
  /** The original store's own receiver-free callable remains the sole actual claim algorithm. */
  const claiming = vi.fn(originalStore.claim)
  /** Existing custom-store injection lends only original claim/lookup and records actual returns. */
  const store: IRpcIdempotencyStore = { claim: claiming, lookup: originalStore.lookup }
  /** Actual native limits supply the original six-provider capacity rather than a fake registry. */
  const admitting = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
  /** Original dispatcher invocations identify the one real provider owner for final inspection. */
  const dispatching = vi.spyOn(ProviderDispatcher.prototype, 'accept')
  /** The original hold provider alone controls when the keyed business actually completes. */
  const release = deferred<void>()
  /** Real application entry proves the first claim reached the provider before duplicate input. */
  const entered = deferred<void>()
  /** Only actual invocation of the original hold provider changes this business count. */
  let effects = 0
  /** Both public groups enter this same originally admitted provider and scope. */
  const server = coreMemoryServer('provider')
  /** The actual optional owners receive the same store, peer token and original capacity6. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      idempotencyFeature({ store, scope: () => 'peer' }),
      limits({ maxGlobal: 6, maxPerPeer: 6 }),
      ...server.options.plugins
    ],
    provide: {
      hold: async (_payload, context) => {
        effects += 1
        entered.resolve()
        await release.promise
        return context.success(42)
      }
    }
  })
  /** Actual bilateral admission supplies both genuine task IDs and caller/provider generations. */
  const client = await server.connect('caller')
  /** Each original caller outcome is observed immediately, including assertion-failure cleanup. */
  const calls: Promise<unknown>[] = []
  /** No inspector exists until the actual dispatcher has processed this case's own input. */
  let inspector: IncomingInspector | undefined
  try {
    /** The first real group retains the store claim until its original hold provider returns. */
    const first = client.host.memory.group([{ method: 'hold' }], { idempotencyKey: 'key' })
    calls.push(first.catch((error: unknown) => error))
    await entered.promise
    /** A distinct actual task with the same body/key must borrow the first claim's pending outcome. */
    const second = client.host.memory.group([{ method: 'hold' }], { idempotencyKey: 'key' })
    calls.push(second.catch((error: unknown) => error))
    await vi.waitFor(() =>
      expect(claiming.mock.results).toContainEqual({
        type: 'return',
        value: expect.objectContaining({ status: 'pending' })
      })
    )
    /** Only the authentic limits instance called by this native dispatch can supply lease counts. */
    const admission = admitting.mock.contexts.find(
      (owner): owner is ProviderAdmissionRegistry => owner instanceof ProviderAdmissionRegistry
    )
    assert(admission)
    /** Reads this exact real dispatcher; there is no replacement controller or work table. */
    const dispatcher = dispatching.mock.contexts.find(
      (owner): owner is ProviderDispatcher => owner instanceof ProviderDispatcher
    )
    assert(dispatcher)
    inspector = new IncomingInspector(dispatcher)
    assert.equal(effects, 1, 'pending original claim cannot run the first duplicate member')
    assert.equal(admission.size, 2)
    /** Changes only the semantic profile; the actual scope callback keeps the same peer token. */
    const scope = JSON.stringify([RpcWireProfile, 'provider', 'peer'])
    assert.deepEqual(store.lookup!(scope, 'key', performance.now()), { state: 'pending' })
    release.resolve()
    await Promise.all([first, second])
    assert.equal(effects, 1)
    /** Retention is read from the original claim owner after both actual callers settle. */
    const retained = store.lookup!(scope, 'key', performance.now())
    assert.equal(retained.state, 'done')
    /** Only actual replies to these groups count; handshake and directory writes are excluded. */
    const replies = client.pair[0].written.filter(
      (frame) => frame.kind === 'result' && frame.task.mode === 'group'
    )
    assert.equal(replies.length, 2)
    await vi.waitFor(() => assert.equal(admission.size, 0))
    await vi.waitFor(async () => assert.equal(await inspector!.pending(), 0))
  } finally {
    release.resolve()
    try {
      await Promise.all(calls)
      await Promise.all([client.host.close(), host.close()])
    } finally {
      claiming.mockRestore()
      admitting.mockRestore()
      dispatching.mockRestore()
      await inspector?.close()
    }
  }
})

/**
 * One original cancellation variant keeps the same real source, store and FIFO through replay and
 * recovery. This single end-to-end lifetime owns its shared cleanup; splitting it would scatter
 * resource ownership or replace the operation whose retained completion is under assertion.
 */
async function clonedStreamReplay(
  code: typeof RpcCoreErrorCode.cancelled | typeof RpcCoreErrorCode.deadlineExceeded
): Promise<void> {
  /** Only the real memory store owns claim, waiter and retained-outcome mutation. */
  const originalStore = createRpcIdempotencyStore()
  /** Cancellation follows the real synchronous claim, preserving the original admitted-store seam. */
  const claiming = vi.fn<IRpcIdempotencyStore['claim']>((scope, key, now, fingerprint) =>
    clonedStreamClaim(originalStore, scope, key, now, fingerprint)
  )
  /** These are the same original custom-store clone boundaries, without a second store algorithm. */
  const store: IRpcIdempotencyStore = {
    claim: claiming,
    lookup: (scope, key, now) => structuredClone(originalStore.lookup!(scope, key, now))
  }
  /** Actual limits occupancy includes the held predecessor and the queued stream until completion. */
  const admitting = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
  /** Original run contexts expose the genuine replay invocation's existing readonly signal getter. */
  const executing = vi.spyOn(ProviderInvocation.prototype, 'run')
  /** Fixed engine-read follows the real dispatcher that accepted these original operations. */
  const dispatching = vi.spyOn(ProviderDispatcher.prototype, 'accept')
  /** This application-owned predecessor holds the actual native orderKey permission. */
  const release = deferred<void>()
  /** Only real hold-provider entry proves the predecessor acquired the shared original FIFO. */
  const entered = deferred<void>()
  /** No initial or replayed stream may invoke the original value provider. */
  let effects = 0
  /** Actual source admission supplies genuine task IDs and immutable caller/provider generations. */
  const server = coreMemoryServer('provider')
  /** Existing feature factories own idempotency, six original leases and all native execution. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      idempotencyFeature({ store, scope: () => 'peer' }),
      limits({ maxGlobal: 6, maxPerPeer: 6 }),
      ...server.options.plugins
    ],
    provide: {
      hold: async (_payload, context) => {
        entered.resolve()
        await release.promise
        return context.success(1)
      },
      value: (_payload, context) => {
        effects += 1
        return context.success(3)
      }
    }
  })
  /** The same physical connection carries initial cancellation, cached replay and later recovery. */
  const client = await server.connect('caller')
  /** This ordinary caller controller delivers actual before-start intent, never a provider facade. */
  const controller = new AbortController()
  /** Observe every original caller outcome immediately, including cleanup after an assertion fails. */
  const pending: Promise<unknown>[] = []
  /** The test retains only its actual accepted dispatcher for the final zero-operation sample. */
  let inspector: IncomingInspector | undefined
  try {
    /** The predecessor is an actual public group, matching the original scalar hold member. */
    const first = client.host.memory.group([{ method: 'hold' }], {
      orderKey: 'queue',
      timeout: false
    })
    pending.push(first.catch((error: unknown) => error))
    await entered.promise
    /** A complete5ms timeout replaces only the old numeric option; real native owners run it. */
    const initial = client.host.memory.stream('value', undefined, {
      orderKey: 'queue',
      idempotencyKey: 'stream-key',
      cancel: 'before-start',
      signal: controller.signal,
      timeout: code === RpcCoreErrorCode.deadlineExceeded ? timeoutFeature({ ms: 5 }) : false
    }) as AsyncIterableIterator<unknown>
    /** First next starts the genuine lazy stream and its original selected timeout/cancellation. */
    const initialOutcome = initial.next().catch((error: unknown) => error)
    pending.push(initialOutcome)
    await vi.waitFor(() => expect(claiming).toHaveBeenCalledTimes(1))
    if (code === RpcCoreErrorCode.cancelled) controller.abort()
    await initialOutcome
    /** Real initial completion must seal before the cloned done claim can serve replay. */
    const scope = JSON.stringify([RpcWireProfile, 'provider', 'peer'])
    await vi.waitFor(() =>
      expect(store.lookup!(scope, 'stream-key', performance.now()).state).toBe('done')
    )
    /** The replay has a new genuine operation signal and no caller cancellation or timeout. */
    const cached = client.host.memory.stream('value', undefined, {
      orderKey: 'queue',
      idempotencyKey: 'stream-key',
      cancel: 'before-start',
      timeout: false
    }) as AsyncIterableIterator<unknown>
    /** Cache presentation must settle through the real producer rather than running business again. */
    const cachedOutcome = cached.next().catch((error: unknown) => error)
    pending.push(cachedOutcome)
    await vi.waitFor(() => expect(executing).toHaveBeenCalledTimes(3))
    /**
     * This exact third invocation follows predecessor and initial stream, without a fake
     * controller.
     */
    const replay = executing.mock.contexts[2]
    assert(replay instanceof ProviderInvocation)
    /** Preserve the original observation before finishing the held predecessor. */
    const signal = replay.signal
    release.resolve()
    await first
    await cachedOutcome
    /** The original identity carrier lends already-prepared request metadata, with no extra decode. */
    const request = client.pair[1].written.findLast(
      (frame) => frame.kind === 'call' && frame.task.mode === 'stream'
    )
    assert(request?.kind === 'call')
    /** Only the correlated genuine non-open stream response can satisfy the original terminal. */
    const terminal = client.pair[0].written.find(
      (frame) =>
        frame.kind === 'stream' &&
        frame.id === request.id &&
        frame.stream.event !== RpcStreamEvent.open
    )
    assert(terminal?.kind === 'stream')
    /** Keep cancelled as a real business assertion; soft records RED while other original atoms run. */
    expect.soft(terminal.stream.event).toBe(RpcStreamEvent.cancelled)
    /** Read the original flat root graph directly; diagnostic observation does not restore it again. */
    const error = 'error' in terminal.stream ? terminal.stream.error : undefined
    assert.equal(error?.nodes[error.root]?.source, RPC_ENDPOINT_ERROR_SOURCE)
    assert.equal(error?.nodes[error.root]?.code, code)
    assert.equal(signal.aborted, false, 'cache presentation cannot cancel the new operation')
    assert.equal(effects, 0)
    /** The exact installed limits owner retains real lease membership, never a claimed zero. */
    const admission = admitting.mock.contexts.find(
      (owner): owner is ProviderAdmissionRegistry => owner instanceof ProviderAdmissionRegistry
    )
    assert(admission)
    /** Inspect the authentic accepted dispatcher through the same finite descriptor pattern. */
    const dispatcher = dispatching.mock.contexts.find(
      (owner): owner is ProviderDispatcher => owner instanceof ProviderDispatcher
    )
    assert(dispatcher)
    inspector = new IncomingInspector(dispatcher)
    await vi.waitFor(async () => assert.equal(await inspector!.pending(), 0))
    await vi.waitFor(() => assert.equal(admission.size, 0))
    /** Actual recovery invokes the original scalar value3 after the zero-stream-effects window. */
    await client.host.memory.group([{ method: 'value' }])
    /** The fresh public group receives its own real response on the same admitted provider. */
    const after = client.pair[1].written.findLast((frame) => frame.kind === 'group')
    assert(after?.kind === 'group')
    assert.ok(
      client.pair[0].written.some((reply) => reply.kind === 'result' && reply.id === after.id)
    )
  } finally {
    controller.abort()
    release.resolve()
    try {
      await Promise.all(pending)
      await Promise.all([client.host.close(), host.close()])
    } finally {
      admitting.mockRestore()
      executing.mockRestore()
      dispatching.mockRestore()
      await inspector?.close()
    }
  }
}

// Exact wire/brand spellings retire; all business atoms remain asserted.
it.each([RpcCoreErrorCode.cancelled, RpcCoreErrorCode.deadlineExceeded] as const)(
  'genuine stored %s stream replay restores only wire cancellation after store cloning',
  clonedStreamReplay
)
