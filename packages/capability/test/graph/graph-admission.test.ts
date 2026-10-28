import { describe, expect, it, vi } from 'vitest'

import { CapabilityGraphErrorCode, createCapabilityGraph } from '../../src/graph/index.js'

import {
  id,
  instance,
  readyInstance,
  startWithDescriptorAdmission,
  asyncReleaseFailureInstance,
  readStaticGraphSource
} from './static-fixtures.js'

/** Covers the contract: rejects missing force at own admission and preserves the coded cause. */
async function rejectsMissingForceAtOwnAdmissionAndPreservesTheCodedCause(): Promise<void> {
  /** A valid sibling proves malformed ownership does not poison later cleanup. */
  const released = vi.fn()
  /** The public graph owns both descriptor admission and eventual release. */
  const graph = createCapabilityGraph()
  graph.register({
    id: id('descriptor'),
    kind: 'test',
    dependencies: [],
    start: (context) => startWithDescriptorAdmission(context, released)
  })
  await graph.ready()
  await graph.dispose()
  expect(released).toHaveBeenCalledTimes(1)
}

/** Covers the contract: exposes the graph subpath contract and stable public nodes. */
function exposesTheGraphSubpathContractAndStablePublicNodes(): void {
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: readyInstance
  })
  expect(graph.nodes).toEqual([id('provider')])
  expect(graph.state).toBe('open')
}

/** Covers the contract: rejects duplicate nodes without polluting the registry. */
async function rejectsDuplicateNodesWithoutPollutingTheRegistry(): Promise<void> {
  const graph = createCapabilityGraph()
  const start = vi.fn(() => instance(1))
  graph.register({ id: id('a'), kind: 'test', dependencies: [], start })
  expect(() => graph.register({ id: id('a'), kind: 'test', dependencies: [], start })).toThrow(
    expect.objectContaining({ code: CapabilityGraphErrorCode.duplicateNode })
  )
  graph.register({
    id: id('b'),
    kind: 'test',
    dependencies: [{ provider: id('missing'), required: true }],
    start
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.unknownProvider
  })
  expect(start).not.toHaveBeenCalled()

  const duplicate = createCapabilityGraph()
  expect(() =>
    duplicate.register({
      id: id('dup'),
      kind: 'test',
      dependencies: [
        { provider: id('p'), required: true },
        { provider: id('p'), required: true }
      ],
      start
    })
  ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.duplicateEdge }))
}

/** Covers the contract: rejects a duplicate dependency edge at registration. */
function rejectsADuplicateDependencyEdgeAtRegistration(): void {
  const graph = createCapabilityGraph()
  expect(() =>
    graph.register({
      id: id('duplicate-edge'),
      kind: 'test',
      dependencies: [
        { provider: id('provider'), required: true },
        { provider: id('provider'), required: true }
      ],
      start: readyInstance
    })
  ).toThrow(expect.objectContaining({ code: CapabilityGraphErrorCode.duplicateEdge }))
}

/** Covers the contract: keeps Graph source free of reactive graph dependencies. */
function keepsGraphSourceFreeOfReactiveGraphDependencies(): void {
  const source = readStaticGraphSource()
  expect(source).not.toMatch(/@migaia\/(reactive|resource|plugin-host|tray)/)
}

/**
 * Covers the contract: keeps optional, dynamic, replacement, and notification paths out of core
 * API.
 */
function keepsOptionalDynamicReplacementAndNotificationPathsOutOfCoreAPI(): void {
  const source = readStaticGraphSource()
  expect(source).not.toMatch(/create(?:Optional|Notification|Replacement|Dynamic)/)
}

/** Covers the contract: rejects non-array dependencies and snapshots array fields once. */
function rejectsNonArrayDependenciesAndSnapshotsArrayFieldsOnce(): void {
  const graph = createCapabilityGraph()
  expect(() =>
    graph.register({
      id: id('hostile'),
      kind: 'test',
      dependencies: new Set() as never,
      start: readyInstance
    })
  ).toThrowError(expect.objectContaining({ code: CapabilityGraphErrorCode.invalidNode }))
  let lengthReads = 0
  let indexReads = 0
  const dependencies = new Proxy([{ provider: id('provider'), required: true as const }], {
    get(target, property, receiver) {
      if (property === 'length') lengthReads += 1
      if (property === '0') indexReads += 1
      if (property === Symbol.iterator) throw new Error('iterator must not be read')
      return Reflect.get(target, property, receiver)
    }
  })
  graph.register({ id: id('array'), kind: 'test', dependencies, start: readyInstance })
  expect(lengthReads).toBe(1)
  expect(indexReads).toBe(1)
}

/** Covers the contract: covers provider admission, result validation, and async teardown rejection. */
async function coversProviderAdmissionResultValidationAndAsyncTeardownRejection(): Promise<void> {
  const contextFailure = createCapabilityGraph()
  contextFailure.register({
    id: id('context'),
    kind: 'test',
    dependencies: [],
    start: ({ get }) => {
      get(id('missing'))
      return instance(1)
    }
  })
  await expect(contextFailure.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.providerUnavailable
  })

  const invalidResult = createCapabilityGraph()
  invalidResult.register({
    id: id('invalid'),
    kind: 'test',
    dependencies: [],
    start: () => null as never
  })
  await expect(invalidResult.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.invalidNode
  })

  const asyncFailure = new Error('async release')
  const asyncGraph = createCapabilityGraph()
  asyncGraph.register({
    id: id('async'),
    kind: 'test',
    dependencies: [],
    start: () => asyncReleaseFailureInstance(asyncFailure)
  })
  await asyncGraph.ready()
  await expect(asyncGraph.dispose()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.disposeFailed
  })

  const lengthFailure = createCapabilityGraph()
  const badArray = new Proxy([] as unknown[], {
    get: (_target, property) => {
      if (property === 'length') throw new Error('length')
      return undefined
    }
  })
  expect(() =>
    lengthFailure.register({
      id: id('length'),
      kind: 'test',
      dependencies: badArray as never,
      start: readyInstance
    })
  ).toThrowError(expect.objectContaining({ code: CapabilityGraphErrorCode.invalidNode }))
  const edgeFailure = createCapabilityGraph()
  const badEdge = new Proxy(
    { provider: id('p'), required: true },
    {
      get: () => {
        throw new Error('edge')
      }
    }
  )
  expect(() =>
    edgeFailure.register({
      id: id('edge'),
      kind: 'test',
      dependencies: [badEdge] as never,
      start: readyInstance
    })
  ).toThrowError(expect.objectContaining({ code: CapabilityGraphErrorCode.invalidNode }))
}

describe('capability graph-admission', () => {
  it(
    'rejects missing force at own admission and preserves the coded cause',
    rejectsMissingForceAtOwnAdmissionAndPreservesTheCodedCause
  )

  it(
    'exposes the graph subpath contract and stable public nodes',
    exposesTheGraphSubpathContractAndStablePublicNodes
  )

  it(
    'rejects duplicate nodes without polluting the registry',
    rejectsDuplicateNodesWithoutPollutingTheRegistry
  )

  it(
    'rejects a duplicate dependency edge at registration',
    rejectsADuplicateDependencyEdgeAtRegistration
  )

  it(
    'keeps Graph source free of reactive graph dependencies',
    keepsGraphSourceFreeOfReactiveGraphDependencies
  )

  it(
    'keeps optional, dynamic, replacement, and notification paths out of core API',
    keepsOptionalDynamicReplacementAndNotificationPathsOutOfCoreAPI
  )

  it(
    'rejects non-array dependencies and snapshots array fields once',
    rejectsNonArrayDependenciesAndSnapshotsArrayFieldsOnce
  )

  it(
    'covers provider admission, result validation, and async teardown rejection',
    coversProviderAdmissionResultValidationAndAsyncTeardownRejection
  )
})
