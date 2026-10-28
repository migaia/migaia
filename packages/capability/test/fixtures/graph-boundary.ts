/** Graph boundary fixtures own controlled startup, empty instances and diagnostic failures. */
import type {
  IGraphNodeInstance,
  IGraphReleaseContext,
  IGraphStartContext
} from '../../src/graph/index.js'
import type { IGraphReleaseEntry, IGraphStartEntry } from '../../src/graph/dynamic.js'

/** No-op physical release is fixture data, without nested callbacks inside startup. */
export function emptyGraphRelease(): void {}
/** Create the same fresh value-one instance for each requested startup. */
export function emptyGraphInstance(): IGraphNodeInstance<unknown> {
  return { value: 1, release: emptyGraphRelease }
}
/** Preserve one fresh instance per entry in the original batch order. */
export function emptyGraphBatch(
  entries: readonly IGraphStartEntry[]
): readonly IGraphNodeInstance<unknown>[] {
  return entries.map(emptyGraphInstance)
}
/** Ignore explicit cleanup reports without changing the releasing owner. */
function ignoreReleaseReport(): void {}
/** Physical test owner still waits for the fence before its original forward release traversal. */
export async function releaseGraphBatch(
  entries: readonly IGraphReleaseEntry[],
  fence: Promise<void>
): Promise<void> {
  await fence
  for (const entry of entries)
    await entry.instance.release({
      nodeId: entry.id,
      signal: new AbortController().signal,
      report: ignoreReleaseReport
    })
}
/** Emit the original release-time diagnostic rather than constructing it during test setup. */
export function reportGraphReleaseDiagnostic(context: IGraphReleaseContext): void {
  context.report(new Error('release diagnostic'))
}
/** Fresh diagnostic instance retains the same value and release-time reporting behavior. */
export function reportingGraphInstance(): IGraphNodeInstance<unknown> {
  return { value: 1, release: reportGraphReleaseDiagnostic }
}

/** Late startup fixture owns the gate and exact auxiliary/primary cleanup observations. */
export class LateGraphStartup {
  /** Startup remains pending until the test releases this exact gate. */
  readonly #gate: Promise<void>
  /** Test-owned list observes auxiliary failure followed by detached primary cleanup. */
  readonly #releases: string[]
  /** Capture pending startup without owning any graph resource yet. */
  constructor(gate: Promise<void>, releases: string[]) {
    this.#gate = gate
    this.#releases = releases
  }
  /** Acquire auxiliary ownership before the original gate and return primary ownership afterwards. */
  readonly start = async (context: IGraphStartContext): Promise<IGraphNodeInstance<unknown>> => {
    context.own({}, { force: this.#releaseAuxiliary })
    await this.#gate
    return { value: {}, release: this.#releasePrimary }
  }
  /** Auxiliary rollback retains its original release-time error and order observation. */
  readonly #releaseAuxiliary = (): void => {
    this.#releases.push('auxiliary')
    throw new Error('auxiliary cleanup')
  }
  /** Late primary cleanup still runs after auxiliary rollback failure. */
  readonly #releasePrimary = (): void => {
    this.#releases.push('primary')
  }
}

/** Rejected reporter fixture preserves the exact error while returning a genuine rejected Promise. */
export class RejectedBoundaryReporter {
  /** User-selected diagnostic failure remains separate from graph or host business errors. */
  readonly #failure: unknown
  /** Capture the diagnostic error without rejecting early. */
  constructor(failure: unknown) {
    this.#failure = failure
  }
  /** Reject only when the existing reporter boundary actually invokes this callback. */
  readonly report = (): Promise<never> => Promise.reject(this.#failure)
}

/** Adapter fixture owns exact primary failure and captured-cause observation. */
export class TopologyAdapterFailure {
  /** Native adapter error must leave the topology boundary with its original identity. */
  readonly #failure: Error
  /** Case-owned observation records the exact captured getter failure. */
  readonly #observe: (cause: unknown) => void
  /** Capture the error and observation without reading any hostile node getter. */
  constructor(failure: Error, observe: (cause: unknown) => void) {
    this.#failure = failure
    this.#observe = observe
  }
  /** Retain original adapter behavior when topology reports a structural or getter failure. */
  readonly invalid = (
    _reason: unknown,
    _id?: string,
    failure?: { readonly cause: unknown }
  ): never => {
    this.#observe(failure?.cause)
    throw this.#failure
  }
}

/** Original unknown-provider fixture constructs its error only when unexpectedly invoked. */
export function throwUnknownProvider(): never {
  throw new Error('unknown')
}
/** Original cycle fixture constructs its error only when unexpectedly invoked. */
export function throwGraphCycle(): never {
  throw new Error('cycle')
}
