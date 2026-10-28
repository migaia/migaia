import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.ts'
import { createObserverBinding, currentRuntimeVersion } from '../src/entry/extension.ts'

describe('audited read-only computed capture', () => {
  it('retains committed upstream edges when the injected idle channel runs synchronously', () => {
    /** Synchronous admitted idle execution must run only after capture graph admission finishes. */
    const runtime = createRuntime({
      scheduleIdle: (task) => task(),
      schedulerStrategy: () => undefined
    })
    /** The lazy node's upstream edge is created only by the host commit. */
    const signal = runtime.signal(1)
    /** This capture must become a real derivation at commit. */
    const computed = runtime.computed(() => signal.value * 2)
    /** Binding callback models a host notification that does not read the computed itself. */
    const binding = createObserverBinding(runtime)
    /** Render result is computed before graph admission. */
    const capture = binding.capture(() => computed.value)
    /** Both observation edges must exist before idle cleanup considers the node unused. */
    const release = binding.observe(() => undefined)
    expect(binding.commit(capture)).toBe('committed')
    expect(signal.observed).toBe(true)
    expect(computed.observed).toBe(true)
    release()
    computed.dispose()
    signal.dispose()
  })
  it('leaves abandoned nested computed capture without edges, versions, or idle work', () => {
    /** Capture may evaluate a derivation but cannot publish graph state. */
    const idle: (() => void)[] = []
    /** All lazy nodes use the same existing runtime clock and tracker. */
    const runtime = createRuntime({
      scheduleIdle: (task) => {
        idle.push(task)
      }
    })
    /** Nested values must both follow the speculative path. */
    const signal = runtime.signal(2)
    /** Inner derivation would otherwise establish the first unwanted edge. */
    const inner = runtime.computed(() => signal.value * 2)
    /** Outer derivation must not commit the inner speculative capture. */
    const outer = runtime.computed(() => inner.value + 1)
    /** No observer is installed, as in an abandoned host render. */
    const binding = createObserverBinding(runtime)
    /** Construction already reserved the signal's initial version. */
    const version = currentRuntimeVersion(runtime)
    expect(binding.capture(() => outer.value).result).toBe(5)
    expect(signal.observed).toBe(false)
    expect(inner.observed).toBe(false)
    expect(outer.observed).toBe(false)
    expect(currentRuntimeVersion(runtime)).toBe(version)
    expect(idle).toHaveLength(0)
    outer.dispose()
    inner.dispose()
    signal.dispose()
  })

  it('commits the captured derivation without reevaluation and then receives updates', () => {
    /** Evaluations happen in render and must not repeat in the host commit phase. */
    let runs = 0
    /** Flush is controlled explicitly so update count has a single owner. */
    const runtime = createRuntime({ schedulerStrategy: () => undefined })
    /** A normal signal is the transitive update source. */
    const signal = runtime.signal(1)
    /** Stable derivation exposes whether commit silently evaluates user code. */
    const inner = runtime.computed(() => {
      runs++
      return signal.value * 2
    })
    /** The host reads the outer lazy node, so commit must admit the full captured tree. */
    const computed = runtime.computed(() => inner.value + 1)
    /** Host subscription owns the eventual observer. */
    const binding = createObserverBinding(runtime)
    /** Successful render token may be committed only once. */
    const captured = binding.capture(() => computed.value)
    /** Host notifications do not themselves read the computed. */
    let notifications = 0
    /** Dispose via the binding rather than exposing its Effect. */
    const release = binding.observe(() => {
      notifications++
    })
    expect(binding.commit(captured)).toBe('committed')
    expect(runs).toBe(1)
    expect(signal.observed).toBe(true)
    expect(inner.observed).toBe(true)
    expect(computed.observed).toBe(true)
    signal.value = 2
    runtime.flush()
    expect(notifications).toBe(2)
    release()
    computed.dispose()
    inner.dispose()
    signal.dispose()
  })

  it('rejects changed transitive dependencies before creating any captured edges', () => {
    /** A changed leaf makes a speculative computed result stale even without a committed graph. */
    const runtime = createRuntime()
    /** Leaf mutation occurs between host render and commit. */
    const signal = runtime.signal(1)
    /** Speculative derivation has no reverse edge to receive markDirty yet. */
    const computed = runtime.computed(() => signal.value * 2)
    /** Token validation stays with the canonical tracker. */
    const binding = createObserverBinding(runtime)
    /** Retain the result of the old leaf value. */
    const captured = binding.capture(() => computed.value)
    signal.value = 2
    /** An observer with no reads must remain disconnected when commit is stale. */
    const release = binding.observe(() => undefined)
    expect(binding.commit(captured)).toBe('stale')
    expect(signal.observed).toBe(false)
    expect(computed.observed).toBe(false)
    release()
    computed.dispose()
    signal.dispose()
  })
})
