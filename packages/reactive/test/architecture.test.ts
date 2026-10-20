import {
  getDefaultRuntime,
  currentRuntimeVersion,
  deferRuntimeCleanup
} from '../src/entry/extension.js'
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as reactivePublicApi from '../src/index.js'
import { createRuntime } from '../src/index.js'
import { ReactiveErrorCode } from '../src/error-code.js'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

// Scope/createScope()/IScope 从公开 API 移除，
// lifecycle-primitives.ts / generation-controller.ts 整体移入 @migaia/lifecycle，reactive 内不留副本。
describe('Scope leaves @migaia/reactive entirely', () => {
  it('the public entry point does not export Scope or createScope as runtime values', () => {
    const exported = reactivePublicApi as Record<string, unknown>
    expect(exported.Scope).toBeUndefined()
    expect(exported.createScope).toBeUndefined()
  })

  it('the public entry point does not source IScope (type-only, checked textually)', () => {
    const indexSource = readFileSync(`${srcDir}/index.ts`, 'utf8')
    expect(indexSource).not.toMatch(/\bIScope\b/)
  })

  it('lifecycle-primitives.ts and generation-controller.ts no longer exist in this package', () => {
    expect(existsSync(`${srcDir}/runtime/lifecycle-primitives.ts`)).toBe(false)
    expect(existsSync(`${srcDir}/runtime/generation-controller.ts`)).toBe(false)
    expect(existsSync(`${srcDir}/runtime/scope.class.ts`)).toBe(false)
  })

  it('no Runtime instance exposes createScope() any more', () => {
    const runtime = createRuntime() as unknown as Record<string, unknown>
    expect(runtime.createScope).toBeUndefined()
  })
})

// Reactive runtime 多实例——SSR request / 测试 / Worker 之间无节点、scope、lease 串线。
// `createScope()` 被移除后，「隔离」不再有一个 scope 对象作为载体，必须由 Runtime 自身的所有权表保证。
describe('multiple Runtime instances stay isolated after createScope() removal', () => {
  it('a node created by one Runtime is rejected by another Runtime’s tracking context', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const foreign = runtimeB.signal(1)
    expect(() =>
      runtimeA.effect(() => {
        expect(foreign.value).toBeDefined()
      })
    ).toThrowError(expect.objectContaining({ code: ReactiveErrorCode.crossRuntime }))
    foreign.dispose()
  })

  it('each Runtime keeps an independent version clock — writes in one never advance the other', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const a = runtimeA.signal(0)
    const beforeB = currentRuntimeVersion(runtimeB)
    a.value = 1
    a.value = 2
    expect(currentRuntimeVersion(runtimeA)).toBeGreaterThan(beforeB)
    expect(currentRuntimeVersion(runtimeB)).toBe(beforeB)
    a.dispose()
  })

  it('each Runtime keeps an independent flush queue — flushing one does not run the other’s effects', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const a = runtimeA.signal(0)
    const b = runtimeB.signal(0)
    let runsA = 0
    let runsB = 0
    const stopA = runtimeA.effect(() => {
      expect(a.value).toBeDefined()
      runsA++
    })
    const stopB = runtimeB.effect(() => {
      expect(b.value).toBeDefined()
      runsB++
    })
    expect([runsA, runsB]).toEqual([1, 1])
    a.value = 1
    b.value = 1
    runtimeA.flush()
    // Only A's queue was drained; B's effect is still pending its own flush.
    expect([runsA, runsB]).toEqual([2, 1])
    runtimeB.flush()
    expect([runsA, runsB]).toEqual([2, 2])
    stopA.dispose()
    stopB.dispose()
    a.dispose()
    b.dispose()
  })

  it('disposing one Runtime’s nodes leaves the other Runtime’s nodes fully usable', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const a = runtimeA.signal(1)
    const b = runtimeB.signal(1)
    a.dispose()
    expect(() => a.value).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.nodeDisposed })
    )
    expect(b.value).toBe(1)
    b.value = 2
    expect(b.value).toBe(2)
    b.dispose()
  })
})

describe('pure default provider', () => {
  it('returns the same authority as the root convenience binding', () => {
    /** The provider must not create a second default graph for extension consumers. */
    const runtime = getDefaultRuntime()
    expect(getDefaultRuntime()).toBe(runtime)
    expect(reactivePublicApi.defaultRuntime).toBe(runtime)
    /** Graph ownership validates the real runtime object, not a proxy or forwarding facade. */
    const signal = runtime.signal(1)
    expect(signal.runtime).toBe(runtime)
    signal.dispose()
  })
})

describe('adapter cleanup capability', () => {
  it('uses the bound Runtime idle channel and reports cleanup failure there', () => {
    const pending: Array<() => void> = []
    const reported: unknown[] = []
    const runtime = createRuntime({
      scheduleIdle: (task) => {
        pending.push(task)
      },
      onError: (error) => {
        reported.push(error)
      }
    })
    const trace: number[] = []
    deferRuntimeCleanup(runtime, () => {
      trace.push(1)
    })
    expect(trace).toEqual([])
    pending.shift()!()
    expect(trace).toEqual([1])
    const failure = new Error('cleanup failed')
    deferRuntimeCleanup(runtime, () => {
      throw failure
    })
    pending.shift()!()
    expect(reported).toEqual([failure])
    expect(() => deferRuntimeCleanup(runtime, null as never)).toThrow(
      expect.objectContaining({ code: ReactiveErrorCode.invalidOption })
    )
    expect(pending).toHaveLength(0)
  })
})
