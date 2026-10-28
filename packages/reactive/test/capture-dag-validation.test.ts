/** Dedicated capture-state validation cases for the authorized shared-DAG linear traversal. */
import { describe, expect, it } from 'vitest'
import { createRuntime, type IReactiveComputed, type IRuntime } from '../src/index.ts'
import {
  createObserverBinding,
  createSourceBinding,
  type ICapture,
  type IObservable,
  type IObserver,
  type IObserverBinding,
  type IRuntimeSourceBinding
} from '../src/entry/extension.ts'

/** One capture retains its binding-owned observer until the test releases that subscription. */
type ICaptureSession = {
  binding: IObserverBinding
  token: ICapture<number>
  stop: () => void
}

/** The fixture observes source checks without altering the version or stale results being read. */
class CountedSource implements IObservable {
  /** All graph operations use the same canonical runtime as the computed capture DAG. */
  readonly runtime: IRuntime
  /** Controlled registration keeps version storage and reverse edges inside reactive. */
  readonly #binding: IRuntimeSourceBinding
  /** Source publication changes this fixture value through the existing commit boundary. */
  #value = 1
  /** Counts version reads during commit after capture and observer creation have finished. */
  #versionReads = 0
  /** Counts pure state checks while retaining the source's always-fresh state. */
  #staleReads = 0

  /** Registers this source before exposing its canonical readonly metadata. */
  constructor(runtime: IRuntime) {
    this.runtime = runtime
    this.#binding = createSourceBinding(this)
  }

  /** Preserves the controlled source's readonly subscriber identity. */
  get subs(): ReadonlySet<IObserver> {
    return this.#binding.subs
  }

  /** Observes each recorded-version comparison without changing the returned canonical version. */
  get version(): number {
    this.#versionReads++
    return this.#binding.version
  }

  /** Reports only this commit's instrumentation rather than adding another source version read. */
  get checks(): { versions: number; stale: number } {
    return { versions: this.#versionReads, stale: this.#staleReads }
  }

  /** Pure state inspection never evaluates a computation or changes graph state. */
  isStale(): boolean {
    this.#staleReads++
    return false
  }

  /** Participates through the existing source tracking port rather than private tracker access. */
  read(): number {
    this.#binding.source.track()
    return this.#value
  }

  /** Publishes one real version change without replacing source identity or graph registration. */
  advance(): void {
    this.#binding.source.commit(() => this.#advanceValue())
  }

  /** Excludes capture, initial observation, and any explicit publication from commit counts. */
  resetChecks(): void {
    this.#versionReads = 0
    this.#staleReads = 0
  }

  /** Releases the source through its existing idempotent controlled lifecycle. */
  dispose(): void {
    this.#binding.source.dispose()
  }

  /** The source commit invokes this write once before it publishes the reserved version. */
  #advanceValue(): void {
    this.#value++
  }
}

/** Owns finite dirty-computed graphs whose dependency snapshots share capture-state identities. */
class CaptureFixture {
  /** Counter instrumentation belongs to one source shared by all speculative branches. */
  readonly source: CountedSource
  /** The host observer, source, and computed nodes use one isolated runtime. */
  readonly #runtime: IRuntime
  /** Every created computed has an explicit removal point in dispose(). */
  readonly #nodes: IReactiveComputed<number>[] = []
  /** The final dirty node is reached only through the public host capture boundary. */
  readonly #root: IReactiveComputed<number>

  /** Builds a shared diamond DAG or a parent/child pair with distinct versions of the same source. */
  constructor(depth: number | 'different-versions') {
    this.#runtime = createRuntime({
      schedulerStrategy: () => undefined,
      scheduleIdle: () => undefined
    })
    this.source = new CountedSource(this.#runtime)
    if (depth === 'different-versions') {
      /** This child records the source's old version before its parent publishes a newer one. */
      const child = this.#runtime.computed(() => this.source.read(), { keepAlive: true })
      /** Parent capture order checks its newer source snapshot before the child's stale snapshot. */
      const parent = this.#runtime.computed(() => this.#readThenChange(child), { keepAlive: true })
      this.#nodes.push(child, parent)
      this.#root = parent
      return
    }
    /** One dirty leaf state is shared across every path through the diamond DAG. */
    let root = this.#runtime.computed(() => this.source.read(), { keepAlive: true })
    this.#nodes.push(root)
    for (let level = 0; level < depth; level++) root = this.#appendDiamond(root)
    this.#root = root
  }

  /** Computed nodes plus this source and the host observer give the complete finite node count. */
  get nodeCount(): number {
    return this.#nodes.length + 2
  }

  /** Captures dirty previews, then creates an empty observer without evaluating the captured DAG. */
  capture(): ICaptureSession {
    /** The public binding owns its concrete observer and every later committed graph edge. */
    const binding = createObserverBinding(this.#runtime)
    /** The same child preview token is retained along both branches of each diamond. */
    const token = binding.capture(() => this.#root.value)
    /** Empty observation introduces no dependency reads before the explicit capture commit. */
    const stop = binding.observe(() => undefined)
    this.source.resetChecks()
    return { binding, token, stop }
  }

  /** Removes every computed and its source after the host subscription has been released. */
  dispose(): void {
    for (const node of this.#nodes) node.dispose()
    this.source.dispose()
  }

  /** Each added diamond retains one predecessor identity along two separate capture paths. */
  #appendDiamond(previous: IReactiveComputed<number>): IReactiveComputed<number> {
    /** The left branch captures this exact shared predecessor. */
    const left = this.#runtime.computed(() => previous.value, { keepAlive: true })
    /** The right branch reuses the predecessor preview and its original capture-state identity. */
    const right = this.#runtime.computed(() => previous.value, { keepAlive: true })
    /** Joining both branches exposes repeated validation paths without adding more source nodes. */
    const joined = this.#runtime.computed(() => left.value + right.value, { keepAlive: true })
    this.#nodes.push(left, right, joined)
    return joined
  }

  /** Records a fresh parent edge before reaching the same source through an older child state. */
  #readThenChange(child: IReactiveComputed<number>): number {
    /** First-read order puts this source ahead of the child in the parent's capture state. */
    const parentValue = this.source.read()
    /** Child capture records the old source version before publication advances the parent snapshot. */
    const childValue = child.value
    this.source.advance()
    return parentValue + childValue
  }
}

describe('capture-state DAG validation', () => {
  it('validates one shared state once across a 39-node dirty diamond graph', () => {
    /** Twelve diamonds produce 37 computed nodes, one controlled source, and one host observer. */
    const fixture = new CaptureFixture(12)
    /** Capture work is excluded so these counts observe only commit validation and edge admission. */
    const session = fixture.capture()
    try {
      expect(fixture.nodeCount).toBe(39)
      expect(session.binding.commit(session.token)).toBe('committed')
      // One validation read plus one version read while applying the single source edge.
      expect(fixture.source.checks).toEqual({ versions: 2, stale: 1 })
      expect(fixture.source.subs.size).toBe(1)
    } finally {
      session.stop()
      fixture.dispose()
    }
  })

  it('rejects a source version changed after a shared DAG capture without installing edges', () => {
    /** Version changes must still reject the whole graph despite shared-state validation reuse. */
    const fixture = new CaptureFixture(12)
    /** No computed or source edge is installed during speculative capture. */
    const session = fixture.capture()
    try {
      fixture.source.advance()
      fixture.source.resetChecks()
      expect(session.binding.commit(session.token)).toBe('stale')
      expect(fixture.source.checks).toEqual({ versions: 1, stale: 0 })
      expect(fixture.source.subs.size).toBe(0)
    } finally {
      session.stop()
      fixture.dispose()
    }
  })

  it('checks each state snapshot when the same dependency records different versions', () => {
    /** Parent source comparison succeeds first; only the child state retains the older version. */
    const fixture = new CaptureFixture('different-versions')
    /** The mutation occurs inside capture, before each enclosing state records its own versions. */
    const session = fixture.capture()
    try {
      expect(session.binding.commit(session.token)).toBe('stale')
      // Deduplicating by dependency instead of state would skip the second comparison and commit.
      expect(fixture.source.checks).toEqual({ versions: 2, stale: 1 })
      expect(fixture.source.subs.size).toBe(0)
    } finally {
      session.stop()
      fixture.dispose()
    }
  })
})
