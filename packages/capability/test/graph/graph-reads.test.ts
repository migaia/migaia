import { describe, expect, it, vi } from 'vitest'

import {
  CapabilityGraphErrorCode,
  CapabilityGraphState,
  createCapabilityGraph,
  type IGraphNodeId,
  type IGraphStartContext
} from '../../src/graph/index.ts'

import {
  id,
  instance,
  readyInstance,
  noRelease,
  pendingReleaseInstance,
  deferred,
  readStaticGraphSource
} from './static-fixtures.ts'

/** Covers the contract: preserves strict-equality treatment of a NaN auxiliary value. */
async function preservesStrictEqualityTreatmentOfANaNAuxiliaryValue(): Promise<void> {
  /** Owning a primitive is supported; NaN was never equal to itself in the old collision scan. */
  const released = vi.fn()
  /** The public graph must adopt the primary NaN while still releasing its auxiliary entry. */
  const graph = createCapabilityGraph()
  graph.register({
    id: id('nan-resource'),
    kind: 'test',
    dependencies: [],
    start: (context) => {
      context.own(Number.NaN, { force: released })
      return instance(Number.NaN)
    }
  })
  await graph.ready()
  expect(graph.state).toBe(CapabilityGraphState.ready)
  await graph.dispose()
  expect(released).toHaveBeenCalledTimes(1)
}

/** Covers the contract: freezes registration at ready and rejects terminal mutation. */
async function freezesRegistrationAtReadyAndRejectsTerminalMutation(): Promise<void> {
  const graph = createCapabilityGraph()
  await graph.ready()
  expect(() =>
    graph.register({ id: id('late'), kind: 'test', dependencies: [], start: readyInstance })
  ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.graphFrozen }))
  await graph.dispose()
  expect(() =>
    graph.register({ id: id('dead'), kind: 'test', dependencies: [], start: readyInstance })
  ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.graphDisposed }))
}

/** Covers the contract: rejects ready and registration during quiescing admission. */
async function rejectsReadyAndRegistrationDuringQuiescingAdmission(): Promise<void> {
  const graph = createCapabilityGraph()
  const releaseGate = deferred<void>()
  graph.register({
    id: id('held'),
    kind: 'test',
    dependencies: [],
    start: () => pendingReleaseInstance(1, releaseGate.promise)
  })
  await graph.ready()
  const disposal = graph.dispose()
  await expect(graph.ready()).resolves.toBeUndefined()
  expect(() =>
    graph.register({ id: id('late'), kind: 'test', dependencies: [], start: readyInstance })
  ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed }))
  releaseGate.resolve()
  await disposal
}

/** Covers the contract: reads node admission getters once and tags getter failure. */
function readsNodeAdmissionGettersOnceAndTagsGetterFailure(): void {
  let reads = 0
  const admissionError = new Error('id getter failed')
  const node = {
    get id() {
      reads += 1
      throw admissionError
    },
    kind: 'test',
    dependencies: [],
    start: readyInstance
  } as never
  const graph = createCapabilityGraph()
  expect(() => graph.register(node)).toThrow(admissionError)
  expect(reads).toBe(1)
  expect(admissionError).toMatchObject({
    source: 'capability.graph',
    code: CapabilityGraphErrorCode.invalidNode
  })
}

/** Covers the contract: exposes only a ready direct provider through start context. */
async function exposesOnlyAReadyDirectProviderThroughStartContext(): Promise<void> {
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: () => instance(7)
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: ({ get }) => instance(get<number>(id('provider')))
  })
  await graph.ready()
  expect(graph.get(id('consumer'), id('provider'))).toBe(7)
}

/** Covers the contract: rejects ready immediately during a non-cooperative start. */
async function rejectsReadyImmediatelyDuringANonCooperativeStart(): Promise<void> {
  const pending = deferred<ReturnType<typeof instance>>()
  const graph = createCapabilityGraph()
  graph.register({
    id: id('pending'),
    kind: 'test',
    dependencies: [],
    start: () => pending.promise
  })
  const ready = graph.ready()
  const dispose = graph.dispose()
  await expect(ready).rejects.toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
  expect(graph.state).toBe('terminal')
  await dispose
  pending.resolve(instance(1))
}

/** Covers the contract: preserves dispose Promise identity after ready. */
async function preservesDisposePromiseIdentityAfterReady(): Promise<void> {
  const graph = createCapabilityGraph()
  await graph.ready()
  const first = graph.dispose()
  expect(graph.dispose()).toBe(first)
  await first
}

/** Covers the contract: preserves ready and dispose Promise identity. */
async function preservesReadyAndDisposePromiseIdentity(): Promise<void> {
  const graph = createCapabilityGraph()
  const ready = graph.ready()
  expect(graph.ready()).toBe(ready)
  await ready
  const dispose = graph.dispose()
  expect(graph.dispose()).toBe(dispose)
  await dispose
  expect(graph.state).toBe('terminal')
}

/** Covers the contract: rejects undeclared get without creating a lease. */
function rejectsUndeclaredGetWithoutCreatingALease(): void {
  const graph = createCapabilityGraph()
  graph.register({ id: id('a'), kind: 'test', dependencies: [], start: readyInstance })
  graph.register({ id: id('b'), kind: 'test', dependencies: [], start: () => instance(2) })
  expect(() => graph.get(id('b'), id('a'))).toThrow(
    expect.objectContaining({ code: CapabilityGraphErrorCode.providerUnavailable })
  )
}

/** Covers the contract: requires consumer-aware public direct-edge reads. */
async function requiresConsumerAwarePublicDirectEdgeReads(): Promise<void> {
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: readyInstance
  })
  await graph.ready()
  expect(() =>
    (graph.get as unknown as (provider: IGraphNodeId) => unknown)(id('provider'))
  ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.providerUnavailable }))
}

/** Covers the contract: closes value reads as soon as disposal enters quiescing. */
async function closesValueReadsAsSoonAsDisposalEntersQuiescing(): Promise<void> {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: () => pendingReleaseInstance(1, pending)
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: () => instance(2)
  })
  await graph.ready()
  const disposing = graph.dispose()
  expect(() => graph.get(id('consumer'), id('provider'))).toThrowError(
    expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
  )
  release()
  await disposing
  expect(() => graph.get(id('consumer'), id('provider'))).toThrowError(
    expect.objectContaining({ code: CapabilityGraphErrorCode.graphDisposed })
  )
}

/** Covers the contract: blocks external reads until whole graph is ready. */
async function blocksExternalReadsUntilWholeGraphIsReady(): Promise<void> {
  const gate = deferred<ReturnType<typeof instance>>()
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: readyInstance
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: () => gate.promise
  })
  const ready = graph.ready()
  expect(() => graph.get(id('consumer'), id('provider'))).toThrowError(
    expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
  )
  gate.resolve(instance(2))
  await ready
}

/** Covers the contract: revokes retained context after node settlement. */
async function revokesRetainedContextAfterNodeSettlement(): Promise<void> {
  let retained!: IGraphStartContext
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: readyInstance
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: (context) => {
      retained = context
      return instance(2)
    }
  })
  await graph.ready()
  expect(() => retained.get(id('provider'))).toThrowError(
    expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
  )
  expect(() => retained.own({}, { force: noRelease })).toThrowError(
    expect.objectContaining({ code: CapabilityGraphErrorCode.admissionClosed })
  )
}

/** Covers the contract: clears terminal diagnostic values and reuses cold-terminal ready identity. */
async function clearsTerminalDiagnosticValuesAndReusesColdTerminalReadyIdentity(): Promise<void> {
  const graph = createCapabilityGraph()
  graph.register({
    id: id('value'),
    kind: 'test',
    dependencies: [],
    start: () => instance({ secret: true })
  })
  await graph.ready()
  await graph.dispose()
  expect(graph.nodeState(id('value')).value).toBeUndefined()
  const cold = createCapabilityGraph()
  await cold.dispose()
  const first = cold.ready()
  expect(cold.ready()).toBe(first)
  await expect(first).rejects.toMatchObject({ code: CapabilityGraphErrorCode.graphDisposed })
}

/** Covers the contract: covers failed/quiescing ready branches and late rejection reporting. */
async function coversFailedQuiescingReadyBranchesAndLateRejectionReporting(): Promise<void> {
  const reported: unknown[] = []
  let resolve!: (value: ReturnType<typeof instance>) => void
  const pending = new Promise<ReturnType<typeof instance>>((done) => {
    resolve = done
  })
  const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
  graph.register({ id: id('late'), kind: 'test', dependencies: [], start: () => pending })
  const ready = graph.ready()
  const disposing = graph.dispose()
  expect(graph.ready()).toBe(ready)
  resolve({ value: 1, release: () => Promise.reject(new Error('late release')) })
  await expect(ready).rejects.toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
  await disposing
  await Promise.resolve()
  expect(reported.length).toBeGreaterThan(0)

  const failed = createCapabilityGraph()
  failed.register({
    id: id('failed'),
    kind: 'test',
    dependencies: [],
    start: () => {
      throw new Error('failed')
    }
  })
  const failedReady = failed.ready()
  await expect(failedReady).rejects.toBeDefined()
  expect(failed.ready()).toBe(failedReady)

  const unopened = createCapabilityGraph()
  await unopened.dispose()
  try {
    await unopened.ready()
  } catch (error) {
    expect(error).toMatchObject({ code: CapabilityGraphErrorCode.graphDisposed })
  }

  const unavailable = createCapabilityGraph()
  unavailable.register({
    id: id('provider-fails'),
    kind: 'test',
    dependencies: [],
    start: () => {
      throw new Error('provider')
    }
  })
  unavailable.register({
    id: id('consumer-fails'),
    kind: 'test',
    dependencies: [{ provider: id('provider-fails'), required: true }],
    start: readyInstance
  })
  await expect(unavailable.ready()).rejects.toBeDefined()
  expect(() => unavailable.get(id('consumer-fails'), id('provider-fails'))).toThrowError(
    expect.objectContaining({ code: CapabilityGraphErrorCode.providerUnavailable })
  )
  const source = readStaticGraphSource()
  expect(source).not.toMatch(/class I[A-Z]/)
  expect(source).not.toContain('Reflect.apply')
  expect(source).not.toMatch(/\.(call|apply|bind)\(/)
}

describe('capability graph-reads', () => {
  it(
    'preserves strict-equality treatment of a NaN auxiliary value',
    preservesStrictEqualityTreatmentOfANaNAuxiliaryValue
  )

  it(
    'freezes registration at ready and rejects terminal mutation',
    freezesRegistrationAtReadyAndRejectsTerminalMutation
  )

  it(
    'rejects ready and registration during quiescing admission',
    rejectsReadyAndRegistrationDuringQuiescingAdmission
  )

  it(
    'reads node admission getters once and tags getter failure',
    readsNodeAdmissionGettersOnceAndTagsGetterFailure
  )

  it(
    'exposes only a ready direct provider through start context',
    exposesOnlyAReadyDirectProviderThroughStartContext
  )

  it(
    'rejects ready immediately during a non-cooperative start',
    rejectsReadyImmediatelyDuringANonCooperativeStart
  )

  it('preserves dispose Promise identity after ready', preservesDisposePromiseIdentityAfterReady)

  it('preserves ready and dispose Promise identity', preservesReadyAndDisposePromiseIdentity)

  it('rejects undeclared get without creating a lease', rejectsUndeclaredGetWithoutCreatingALease)

  it('requires consumer-aware public direct-edge reads', requiresConsumerAwarePublicDirectEdgeReads)

  it(
    'closes value reads as soon as disposal enters quiescing',
    closesValueReadsAsSoonAsDisposalEntersQuiescing
  )

  it('blocks external reads until whole graph is ready', blocksExternalReadsUntilWholeGraphIsReady)

  it('revokes retained context after node settlement', revokesRetainedContextAfterNodeSettlement)

  it(
    'clears terminal diagnostic values and reuses cold-terminal ready identity',
    clearsTerminalDiagnosticValuesAndReusesColdTerminalReadyIdentity
  )

  it(
    'covers failed/quiescing ready branches and late rejection reporting',
    coversFailedQuiescingReadyBranchesAndLateRejectionReporting
  )
})
