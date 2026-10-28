/**
 * Reproducible graph operations own their state in one named fixture; expected graph logic stays
 * separate.
 */
import { expect } from 'vitest'
import {
  createRuntime,
  ReactiveErrorCode,
  type IReactiveSignal,
  type IRuntime
} from '../src/index.ts'
import {
  createObserverBinding,
  internalRuntimeOf,
  invalidateObservable,
  type IInternalRuntime
} from '../src/entry/extension.ts'
import {
  ModelSignal,
  ModelTrackedObserver,
  commitModel,
  clearModel,
  suspendModel,
  revalidateModel,
  type IModelSource,
  type IModelObserver,
  type IModelFixture,
  type IFailureKind
} from './link-edge-model-reference.ts'

/** Six source slots and three observer slots keep every seeded operation finite and reproducible. */
class ModelFixture implements IModelFixture {
  /** Seed identifies the exact deterministic operation stream in failure messages. */
  #seed: number
  /** Manual flushing isolates one supported graph operation from host microtasks. */
  #runtime: IRuntime
  /** Readonly graph metadata comes only from the supported controlled-extension boundary. */
  #graphRuntime: IInternalRuntime
  /** Diagnostic labels distinguish active, replacement, and temporary nodes. */
  #labels = new Map<object, string>()
  /** Actual notifications are written exclusively by real production callbacks. */
  #actualNotifications: string[] = []
  /** Independently planned notifications are computed before the real operation. */
  #expectedNotifications: string[] = []
  /** Actual effect bodies record the complete observed execution sequence. */
  #actualEffects: string[] = []
  /** Expected effect work is planned from fixture inputs before execution. */
  #expectedEffects: string[] = []
  /** Temporary gadget sources join graph checks only while they remain alive. */
  #extraSources: IModelSource[] = []
  /** Temporary gadget observers have explicit removal at gadget completion. */
  #extraObservers: IModelObserver[] = []
  /** Replacement nodes never reuse earlier diagnostic labels. */
  #serial = 0
  /** Xorshift32 advances only in the named random method. */
  #randomState: number
  /** Every assertion identifies the seeded operation that produced it. */
  #context: string
  /** Six live source slots are replaced only after terminal graph cleanup. */
  #sources: IModelSource[]
  /** Three live custom observers retain independent reference states. */
  #observers: IModelObserver[]
  /** Failed-read operations reuse this already-disposed source. */
  #disposedSource: IModelSource
  /** Foreign reads exercise the existing cross-runtime admission boundary. */
  #foreign: IReactiveSignal<number>

  /** Initialize the same fixed graph and operation stream as the original reference fixture. */
  constructor(seed: number) {
    this.#seed = seed
    this.#runtime = createRuntime({ schedulerStrategy: () => undefined })
    this.#graphRuntime = internalRuntimeOf(this.#runtime)
    this.#randomState = seed >>> 0
    this.#context = `seed=${seed}, initial`
    this.#sources = Array.from({ length: 6 }, (_, index) => this.#makeSignal(index + 1))
    this.#observers = Array.from({ length: 3 }, () => this.#makeObserver())
    this.#disposedSource = this.#makeSignal(-1)
    this.#disposedSource.dispose()
    this.#disposedSource.disposed = true
    /** The foreign runtime owns only the reusable failed-read source. */
    const foreignRuntime = createRuntime({ schedulerStrategy: () => undefined })
    this.#foreign = foreignRuntime.signal(-2)
    for (let index = 0; index < this.#observers.length; index++) {
      this.#track(this.#observers[index]!, [
        this.#sources[index]!,
        this.#sources[(index + 1) % this.#sources.length]!
      ])
    }
    this.#check()
  }
  /** Return a bounded index while retaining the entire reproducible random stream in the seed. */
  #random(limit: number): number {
    this.#randomState ^= this.#randomState << 13
    this.#randomState ^= this.#randomState >>> 17
    this.#randomState ^= this.#randomState << 5
    return (this.#randomState >>> 0) % limit
  }

  /** Apply invalidation to all live reverse edges before scheduling disconnect callbacks. */
  #disconnectModel(source: IModelSource, terminal: boolean): void {
    /** Snapshot insertion order is the independent notification-order expectation. */
    const affected = [...source.subs]
    source.topology++
    if (terminal) source.disposed = true
    source.subs.clear()
    for (const observer of affected) {
      observer.deps.delete(source)
      observer.versions.delete(source)
    }
    for (const observer of affected) {
      if (observer.role === 'tracked')
        this.#expectedNotifications.push(`disconnect:${observer.label}:${source.label}`)
    }
  }

  /** Plan ordinary source callbacks from the reference insertion order before performing a write. */
  #write(source: IModelSource): void {
    for (const observer of source.subs) {
      if (observer.role === 'tracked') this.#expectedNotifications.push(`dirty:${observer.label}`)
    }
    source.value++
    source.write!(source.value)
    this.#runtime.flush()
  }

  /** Run only the requested reads; duplicates exercise first-read deduplication explicitly. */
  #track(observer: IModelObserver, reads: readonly IModelSource[]): void {
    observer.binding!.runTracked(() => {
      for (const source of reads) source.read()
    })
    commitModel(observer, reads)
  }

  /** Short ordered plans vary membership and duplicate reads without creating unsupported cycles. */
  #readPlan(): IModelSource[] {
    return Array.from(
      { length: this.#random(5) + 1 },
      () => this.#sources[this.#random(this.#sources.length)]!
    )
  }

  /** Include retired sources that remain reachable through a suspended version snapshot. */
  #checkedSources(): Set<IModelSource> {
    /** Active slots and temporary derived nodes are the ordinary source population. */
    const result = new Set([...this.#sources, ...this.#extraSources])
    for (const observer of [...this.#observers, ...this.#extraObservers]) {
      for (const source of observer.versions.keys()) result.add(source)
      for (const source of observer.deps) result.add(source)
    }
    return result
  }

  /** Compare order, versions, callback sequences and both graph directions after every operation. */
  #check(): void {
    expect(this.#actualNotifications, this.#context).toEqual(this.#expectedNotifications)
    expect(this.#actualEffects, this.#context).toEqual(this.#expectedEffects)
    for (const observer of [...this.#observers, ...this.#extraObservers]) {
      expect(
        [...observer.node.deps].map((node) => this.#labels.get(node)),
        this.#context
      ).toEqual([...observer.deps].map((source) => source.label))
      expect(
        [...observer.node.depVersions].map(([node, version]) => [this.#labels.get(node), version]),
        this.#context
      ).toEqual([...observer.versions].map(([source, version]) => [source.label, version]))
      if (observer.binding)
        expect(observer.binding.isSuspended(), this.#context).toBe(observer.suspended !== undefined)
    }
    /** A single counter records all mirror violations without expensive nested matcher output. */
    let mirrorViolations = 0
    for (const source of this.#checkedSources()) {
      expect(
        [...source.node.subs].map((node) => this.#labels.get(node)),
        this.#context
      ).toEqual([...source.subs].map((observer) => observer.label))
      for (const observer of [...this.#observers, ...this.#extraObservers]) {
        if (source.node.subs.has(observer.node) !== observer.node.deps.has(source.node))
          mirrorViolations++
      }
    }
    expect(mirrorViolations, this.#context).toBe(0)
  }

  /** Failed reads first stage a different candidate topology, then retain the exact original error. */
  failure(kind: IFailureKind): void {
    /** This observer already has committed or suspended state that must survive the failure. */
    const observer = this.#observers[this.#random(this.#observers.length)]!
    /** Neither failed staging nor callback coding may change any existing view. */
    const before = this.#snapshotViews()
    /** The failed candidate always includes a new edge, making premature commit detectable. */
    const staged = this.#sources.find((source) => !observer.deps.has(source))!
    /** A native callback error must survive with identity and native type intact. */
    const businessFailure = new RangeError(`model failure ${this.#seed}`)
    /** Capture source failures at their originating read, before the callback boundary sees them. */
    let original: unknown
    let caught: unknown
    try {
      observer.binding!.runTracked(() => {
        staged.read()
        for (const source of this.#readPlan()) source.read()
        try {
          if (kind === 'disposed') this.#disposedSource.read()
          else if (kind === 'cross-runtime') void this.#foreign.value
          else throw businessFailure
        } catch (error) {
          original = error
          throw error
        }
      })
    } catch (error) {
      caught = error
    }
    expect(original, this.#context).toBeDefined()
    expect(caught, this.#context).toBe(original)
    if (kind === 'throw') expect(caught, this.#context).toBe(businessFailure)
    else
      expect(caught, this.#context).toMatchObject({
        code: kind === 'disposed' ? ReactiveErrorCode.nodeDisposed : ReactiveErrorCode.crossRuntime
      })
    expect(this.#snapshotViews(), this.#context).toEqual(before)
    this.#check()
  }

  /**
   * Capture uses the host binding's own Effect. Stable commit installs the independently planned
   * graph; discard/staleness install nothing. A later write proves the committed effect executes
   * once and its empty body removes the capture-installed dependencies.
   */
  #capture(mode: 'commit' | 'discard' | 'stale'): void {
    /** Tokens capture only this explicitly generated first-read plan. */
    const reads = this.#readPlan()
    /** The host binding owns its observer lifecycle rather than exposing tracker services. */
    const binding = createObserverBinding(this.#runtime)
    const token = binding.capture(() => {
      for (const source of reads) source.read()
    })
    this.#check()
    if (mode === 'discard') return
    /** The actual effect records executions but never updates the model from inside its callback. */
    const label = `capture-effect-${this.#serial++}`
    this.#expectedEffects.push(label)
    const release = binding.observe(() => {
      this.#actualEffects.push(label)
    })
    if (mode === 'stale') {
      if (this.#random(2) === 0) this.#write(reads[0]!)
      else {
        this.#disconnectModel(reads[0]!, false)
        invalidateObservable(this.#runtime, reads[0]!.node)
      }
      expect(binding.commit(token), this.#context).toBe('stale')
      release()
      this.#check()
      return
    }
    /** Identity discovery uses an existing read-only subscriber view, not private Effect state. */
    const existing = new Set(reads[0]!.node.subs)
    expect(binding.commit(token), this.#context).toBe('committed')
    const node = [...reads[0]!.node.subs].find((candidate) => !existing.has(candidate))!
    expect(node, this.#context).toBeDefined()
    this.#labels.set(node, label)
    /** Expected graph contents come from the input plan, not the newly discovered observer views. */
    const observer: IModelObserver = {
      node,
      label,
      role: 'effect',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      dispose: release
    }
    this.#extraObservers.push(observer)
    commitModel(observer, reads)
    this.#check()
    this.#expectedEffects.push(label)
    this.#write(reads[0]!)
    clearModel(observer)
    this.#check()
    observer.disposed = true
    release()
    this.#extraObservers.splice(this.#extraObservers.indexOf(observer), 1)
  }

  /** A real conditional Computed/Effect pair joins the random sources and changes upstream edges. */
  #computedEffect(): void {
    /** Distinct branches guarantee an actual membership change when the gate switches. */
    const leftIndex = this.#random(this.#sources.length)
    const left = this.#sources[leftIndex]!
    const right =
      this.#sources[
        (leftIndex + this.#random(this.#sources.length - 1) + 1) % this.#sources.length
      ]!
    /** An explicit source makes the conditional switch observable to the canonical scheduler. */
    const gate = this.#makeSignal(0)
    this.#extraSources.push(gate)
    /** Keep-alive removes idle timing from this finite graph/order comparison. */
    const label = `computed-${this.#serial++}`
    const derived = this.#graphRuntime.computed(
      () => (gate.read() === 0 ? left.read() : right.read() + 1000000),
      { keepAlive: true, debugName: label }
    )
    this.#labels.set(derived, label)
    /** The same concrete node has separate expected observable and observer roles. */
    const source: IModelSource = {
      node: derived,
      label,
      value: left.value,
      disposed: false,
      topology: 0,
      subs: new Set(),
      read: () => derived.value,
      dispose: () => derived.dispose()
    }
    const computed: IModelObserver = {
      node: derived,
      label,
      role: 'computed',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      dispose: () => derived.dispose()
    }
    this.#extraSources.push(source)
    this.#extraObservers.push(computed)
    /** Expected values are calculated from fixture inputs before any actual effect body runs. */
    const effectLabel = `effect-${this.#serial++}`
    this.#expectedEffects.push(`${effectLabel}:${left.value}`)
    const effect = this.#runtime.effect(() => {
      this.#actualEffects.push(`${effectLabel}:${derived.value}`)
    })
    const node = [...derived.subs][0]!
    this.#labels.set(node, effectLabel)
    const observer: IModelObserver = {
      node,
      label: effectLabel,
      role: 'effect',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      dispose: () => effect.dispose()
    }
    this.#extraObservers.push(observer)
    commitModel(computed, [gate, left])
    commitModel(observer, [source])
    this.#check()
    gate.value = 1
    source.value = right.value + 1000000
    this.#expectedEffects.push(`${effectLabel}:${source.value}`)
    gate.write!(1)
    this.#runtime.flush()
    commitModel(computed, [gate, right])
    commitModel(observer, [source])
    this.#check()
    clearModel(observer)
    observer.disposed = true
    effect.dispose()
    clearModel(computed)
    computed.disposed = true
    this.#disconnectModel(source, true)
    derived.dispose()
    this.#disconnectModel(gate, true)
    gate.dispose()
    this.#check()
    this.#extraObservers.splice(this.#extraObservers.indexOf(observer), 1)
    this.#extraObservers.splice(this.#extraObservers.indexOf(computed), 1)
    this.#extraSources.splice(this.#extraSources.indexOf(source), 1)
    this.#extraSources.splice(this.#extraSources.indexOf(gate), 1)
  }

  /** Construct one real source with independent expected membership state. */
  #makeSignal(value: number): IModelSource {
    /** Replacement labels are never reused by later source slots. */
    const label = `signal-${this.#serial++}`
    /** The reference source delegates real operations to this one canonical node. */
    const source = new ModelSignal(
      this.#graphRuntime.signal(value, { debugName: label }),
      label,
      value
    )
    this.#labels.set(source.node, label)
    return source
  }

  /** Custom observer lifecycle belongs to its named owner rather than captured mutable locals. */
  #makeObserver(): IModelObserver {
    /** Replacements need identities distinct from every previously disconnected observer. */
    const label = `observer-${this.#serial++}`
    /** Actual and expected graph state remain independent on the named fixture owner. */
    const observer = new ModelTrackedObserver(
      this.#runtime,
      label,
      this.#actualNotifications,
      this.#labels
    )
    this.#labels.set(observer.node, label)
    return observer
  }

  /** Snapshot observer labels and version entries without nesting collection callbacks. */
  #snapshotObserver(observer: IModelObserver) {
    /** Live production dependency order is recorded before a potentially failing operation. */
    const deps: Array<string | undefined> = []
    /** Version tuples retain the original source-label and version ordering. */
    const versions: Array<[string | undefined, number]> = []
    for (const node of observer.node.deps) deps.push(this.#labels.get(node))
    for (const [node, version] of observer.node.depVersions)
      versions.push([this.#labels.get(node), version])
    return { label: observer.label, deps, versions }
  }

  /** Snapshot reverse memberships independently from model memberships. */
  #snapshotSource(source: IModelSource) {
    /** Subscriber order is the complete live readonly production view. */
    const subs: Array<string | undefined> = []
    for (const node of source.node.subs) subs.push(this.#labels.get(node))
    return { label: source.label, subs }
  }

  /** Preserve the original snapshot shape and insertion order for exact rollback assertions. */
  #snapshotViews() {
    return {
      observers: [...this.#observers, ...this.#extraObservers].map((observer) =>
        this.#snapshotObserver(observer)
      ),
      sources: [...this.#checkedSources()].map((source) => this.#snapshotSource(source))
    }
  }
  /** Execute one reproducible planned operation, then compare every graph view and callback history. */
  step(index: number): void {
    /** The first cycle guarantees every operation category occurs for every fixed seed. */
    const operation = index < 16 ? index : this.#random(16)
    this.#context = `seed=${this.#seed}, step=${index}, operation=${operation}`
    /** Main operands are selected from bounded live slots before the operation changes topology. */
    const observerIndex = this.#random(this.#observers.length)
    const observer = this.#observers[observerIndex]!
    const sourceIndex = this.#random(this.#sources.length)
    const source = this.#sources[sourceIndex]!
    if (operation === 0) {
      this.#disconnectModel(source, true)
      source.dispose()
      expect(source.node.subs.size, this.#context).toBe(0)
      this.#sources[sourceIndex] = this.#makeSignal(this.#random(100))
    } else if (operation === 1) {
      clearModel(observer)
      observer.disposed = true
      observer.dispose()
      observer.dispose()
      expect([...observer.node.deps], this.#context).toEqual([])
      expect([...observer.node.depVersions], this.#context).toEqual([])
      this.#observers[observerIndex] = this.#makeObserver()
    } else if (operation === 2) {
      /** Both the reference plan and actual conditional derive their branch from the selector value. */
      const branch = this.#sources[0]!.value % 2 === 0 ? this.#sources[1]! : this.#sources[2]!
      observer.binding!.runTracked(() => {
        if (this.#sources[0]!.read() % 2 === 0) this.#sources[1]!.read()
        else this.#sources[2]!.read()
        this.#sources[0]!.read()
      })
      commitModel(observer, [this.#sources[0]!, branch, this.#sources[0]!])
    } else if (operation === 3) {
      /** Read-order reversal with identical membership must retain the old insertion positions. */
      const reads = observer.deps.size ? [...observer.deps].reverse() : this.#readPlan()
      this.#track(observer, [...reads, ...reads])
    } else if (operation >= 4 && operation <= 6) {
      this.failure((['throw', 'disposed', 'cross-runtime'] as const)[operation - 4]!)
    } else if (operation === 7) {
      observer.binding!.suspend()
      suspendModel(observer)
    } else if (operation === 8) {
      /** The reference uses independent topology epochs and public source versions only. */
      const expected = revalidateModel(observer)
      expect(observer.binding!.revalidate(), this.#context).toBe(expected)
    } else if (operation >= 9 && operation <= 11) {
      this.#capture((['commit', 'discard', 'stale'] as const)[operation - 9]!)
    } else if (operation === 12) {
      this.#disconnectModel(source, false)
      invalidateObservable(this.#runtime, source.node)
    } else if (operation === 13) this.#write(source)
    else if (operation === 14) this.#computedEffect()
    else {
      observer.binding!.clear()
      clearModel(observer)
    }
    this.#check()
  }

  /** Release actual observers before their sources, including retained failed-read fixtures. */
  dispose(): void {
    for (const observer of [...this.#observers, ...this.#extraObservers]) observer.dispose()
    for (const source of [...this.#sources, ...this.#extraSources]) source.dispose()
    this.#disposedSource.dispose()
    this.#foreign.dispose()
  }
}

/** Construct one named fixture without captured component state. */
export function createModelFixture(seed: number): IModelFixture {
  return new ModelFixture(seed)
}
