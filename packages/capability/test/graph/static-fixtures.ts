/** Shared fixtures for static graph contracts; no startup or cleanup logic is duplicated. */
import { expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CapabilityGraphErrorCode,
  createCapabilityGraph,
  type ICapabilityGraph,
  type IGraphNodeDefinition,
  type IGraphNodeId,
  type IGraphStartContext
} from '../../src/graph/index.ts'

/** Gives fixture IDs the public nominal type. */
export const id = (value: string): IGraphNodeId => value as IGraphNodeId

/** Creates a caller-owned primary resource with an observable release callback. */
export const instance = <T>(value: T, release: () => void | PromiseLike<void> = vi.fn()) => ({
  value,
  release
})

/** Supplies the same fresh unit-valued resource to nested registration-admission fixtures. */
export function readyInstance() {
  return instance(1)
}

/** Valid no-op descriptor force keeps executable fixture setup outside assertion callbacks. */
export function noRelease(): void {
  return undefined
}

/** Exercises missing-force admission without nesting its assertion inside a start callback. */
export function startWithDescriptorAdmission(context: IGraphStartContext, released: () => void) {
  expect(() => context.own({}, {} as never)).toThrowError(
    expect.objectContaining({
      code: CapabilityGraphErrorCode.invalidOption,
      cause: expect.objectContaining({ code: 'INVALID_OPTION' })
    })
  )
  context.own({}, { force: released })
  return instance(1)
}

/** Registers one traced node, preserving its name and provider-first/reverse-release evidence. */
export function registerTracedStaticNode(
  graph: ICapabilityGraph,
  name: string,
  dependencies: IGraphNodeDefinition<unknown>['dependencies'],
  started: string[],
  released: string[]
): void {
  /** One explicit fixture context carries invocation and physical-release observations. */
  const context = { name, started, released }
  graph.register({
    id: id(name),
    kind: 'test',
    dependencies,
    start: () => startTracedStaticInstance(context)
  })
}

/** Invocation and release observations for one deliberately ordered static node. */
type IStaticTraceContext = {
  name: string
  started: string[]
  released: string[]
}

/** Owns the traced fixture resource while each short callback captures one explicit context. */
function startTracedStaticInstance(context: IStaticTraceContext) {
  context.started.push(context.name)
  return {
    value: context.name,
    release: () => {
      context.released.push(context.name)
    }
  }
}

/** Creates a primary whose exact failure remains observable at physical release. */
export function failingStaticInstance<T>(value: T, failure: unknown) {
  return instance(value, () => {
    throw failure
  })
}

/** Creates the original asynchronously rejecting cleanup with its exact supplied failure. */
export function asyncReleaseFailureInstance(failure: unknown) {
  return { value: 1, release: () => Promise.reject(failure) }
}

/** Allocates the matrix's native cleanup error only when physical release actually executes. */
export function freshReleaseFailureInstance() {
  return {
    value: 1,
    release: () => {
      throw new Error('release')
    }
  }
}

/** Keeps a primary release pending on the caller's exact completion Promise. */
export function pendingReleaseInstance<T>(value: T, pending: Promise<void>) {
  return instance(value, () => pending)
}

/** A failed auxiliary reports the exact cleanup object without changing primary-error ownership. */
export function failingAuxiliaryDescriptor(failure: unknown) {
  return {
    force: () => {
      throw failure
    }
  }
}

/** Records the original event label when lifecycle physically releases an auxiliary. */
export function tracedAuxiliaryDescriptor(events: string[], name: string) {
  return {
    force: () => {
      events.push(name)
    }
  }
}

/** Retains the descriptor-shape fixture while callbacks stay in a named startup owner. */
export function startWithAuxiliaryDescriptors(context: IGraphStartContext, events: string[]) {
  /** The auxiliary deliberately has a different identity from the primary value. */
  const resource = {}
  context.own(resource, {
    syncSafe: true,
    gracefulTimeoutMs: 1,
    graceful: () => {
      events.push('graceful')
    },
    force: () => {
      events.push('force')
    },
    gcFallback: true,
    custom: () => {
      events.push('custom')
    }
  })
  return { value: 'primary', release: () => releasePrimaryAfterMicrotask(events) }
}

/** Records the same primary-release event on the original Promise continuation boundary. */
function releasePrimaryAfterMicrotask(events: string[]): Promise<void> {
  return Promise.resolve().then(() => {
    events.push('primary')
  })
}

/** Checks each native graph boundary error and contributes to one complete shared code matrix. */
export function assertGraphErrorCode(error: unknown, code: string, seenCodes: Set<string>): void {
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ source: 'capability.graph', code })
  expect((error as Error).stack).toEqual(expect.any(String))
  expect((error as Error).stack!.length).toBeGreaterThan(0)
  expect((error as Error).message.length).toBeGreaterThan(0)
  seenCodes.add(code)
}

/** Creates a primary that records physical release before throwing its exact cleanup failure. */
export function failingTracedStaticInstance<T>(
  value: T,
  context: { released: string[]; name: string; failure: unknown }
) {
  return instance(value, () => {
    context.released.push(context.name)
    throw context.failure
  })
}

/** Creates a primary whose physical release appends the original event label. */
export function tracedStaticInstance<T>(value: T, released: string[], name: string) {
  return instance(value, () => {
    released.push(name)
  })
}

/** A primary intentionally calls readiness again during graph disposal. */
export function readinessReentryInstance(graph: ICapabilityGraph) {
  return instance(1, () => graph.ready())
}

/** A primary intentionally calls disposal again during graph disposal. */
export function disposalReentryInstance(graph: ICapabilityGraph) {
  return instance(1, () => graph.dispose())
}

/** Retains the existing bounded startup timing fixture without deeply nested node callbacks. */
export async function measureStaticStartup(size: number): Promise<number> {
  /** Each measurement owns and disposes its independent graph. */
  const measured = createCapabilityGraph()
  for (let index = 0; index < size; index += 1) {
    measured.register({
      id: id(`measure-${size}-${index}`),
      kind: 'benchmark',
      dependencies:
        index === 0 ? [] : [{ provider: id(`measure-${size}-${index - 1}`), required: true }],
      start: () => instance(index)
    })
  }
  /** Only readiness duration is measured, matching the original case. */
  const startedAt = performance.now()
  await measured.ready()
  /** Physical cleanup remains outside the measured startup interval. */
  const elapsed = performance.now() - startedAt
  await measured.dispose()
  return elapsed
}

/** Controls startup settlement without timing assumptions. */
export const deferred = <T>() => {
  /** The test controls successful settlement without changing Promise identity. */
  let resolve!: (value: T) => void
  /** The test controls rejection with the original failure object. */
  let reject!: (error: unknown) => void
  /** One shared pending result exposes startup and cleanup races deterministically. */
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Static implementation modules jointly replace the former single-file owner. */
const staticModules = [
  'index.ts',
  'static-graph.ts',
  'static-node.ts',
  'node-start.ts',
  'node-start-descriptor.ts',
  'provider-availability.ts'
] as const

/** Reads every static owner so source architecture assertions retain their original scope. */
export function readStaticGraphSource(): string {
  return staticModules
    .map((name) => readFileSync(new URL(`../../src/graph/${name}`, import.meta.url), 'utf8'))
    .join('\n')
}
