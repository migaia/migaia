import { describe, expect, it, vi } from 'vitest'
import { createRuntime, ReactiveErrorCode, type IRuntime } from '../src/index.js'
import {
  createSourceBinding,
  type IObservable,
  type IObserver,
  type IRuntimeSourceBinding
} from '../src/entry/extension.js'

/** Uses the same graph identity and construction protocol as a SAB custom source. */
class CustomSource implements IObservable {
  readonly runtime: IRuntime
  readonly subs: ReadonlySet<IObserver>
  /** Canonical binding owns source versions, subscribers and operations. */
  readonly #binding: IRuntimeSourceBinding

  /** Binds before publishing graph metadata; no dependency frame can observe partial setup. */
  constructor(runtime: IRuntime) {
    this.runtime = runtime
    this.#binding = createSourceBinding(this)
    this.subs = this.#binding.subs
  }

  get version(): number {
    return this.#binding.version
  }
  get source() {
    return this.#binding.source
  }
}

describe('controlled custom source binding', () => {
  it('keeps versions, readonly edges, ownership and duplicate-registration isolation', () => {
    /** One isolated runtime supplies the version clock and dependency frame. */
    const runtime = createRuntime()
    /** Graph node identity remains the custom class instance. */
    const node = new CustomSource(runtime)
    /** The public source operations can be borrowed without changing their target. */
    const notify = node.source.notify
    /** Records each update delivered by the source's canonical subscriber set. */
    const read = vi.fn(() => node.source.track())
    /** A real Effect proves the binding enters the normal kernel graph. */
    const effect = runtime.effect(read)
    expect(node.subs.size).toBe(1)
    expect(node.subs).not.toHaveProperty('add')
    expect([...node.subs][0]!.deps.has(node)).toBe(true)
    /** Failed rebinding must preserve this exact live edge and its version history. */
    const version = node.version
    expect(() => createSourceBinding(node)).toThrow(
      expect.objectContaining({
        code: ReactiveErrorCode.graphNodeRegistered
      })
    )
    expect(node.subs.size).toBe(1)
    notify()
    runtime.flush()
    expect(node.version).toBeGreaterThan(version)
    expect(read).toHaveBeenCalledTimes(2)
    expect(() => createRuntime().effect(() => node.source.track())).toThrow(
      expect.objectContaining({ code: ReactiveErrorCode.crossRuntime })
    )
    effect.dispose()
    node.source.dispose()
    node.source.dispose()
    expect(node.subs.size).toBe(0)
    expect(() => node.source.track()).toThrow(
      expect.objectContaining({
        code: ReactiveErrorCode.nodeDisposed
      })
    )
  })
})
