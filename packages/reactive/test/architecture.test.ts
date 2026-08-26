import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as reactivePublicApi from '../src/index'
import { createRuntime } from '../src/runtime/runtime.class'
import { Signal } from '../src/reactive/signal.class'
import { ReactiveErrorCode } from '../src/error-code'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

// M-T：docs/lifecycle/migration.sdd.md §4.1 —— Scope/createScope()/IScope 从公开 API 移除，
// lifecycle-primitives.ts / generation-controller.ts 整体移入 @migaia/lifecycle，reactive 内不留副本。
describe('M-T1/M-T14 (§5.1/§5.2): Scope leaves @migaia/reactive entirely', () => {
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

// M-T14：reactive runtime 多实例——SSR request / 测试 / Worker 之间无节点、scope、lease 串线。
// `createScope()` 被移除后，「隔离」不再有一个 scope 对象作为载体，必须由 Runtime 自身的所有权表保证。
describe('M-T14 (§5.2): multiple Runtime instances stay isolated after createScope() removal', () => {
  it('a node created by one Runtime is rejected by another Runtime’s tracking context', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const foreign = new Signal(1, runtimeB)
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
    const a = new Signal(0, runtimeA)
    const beforeB = runtimeB.currentVersion()
    a.value = 1
    a.value = 2
    expect(runtimeA.currentVersion()).toBeGreaterThan(beforeB)
    expect(runtimeB.currentVersion()).toBe(beforeB)
    a.dispose()
  })

  it('each Runtime keeps an independent flush queue — flushing one does not run the other’s effects', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const a = new Signal(0, runtimeA)
    const b = new Signal(0, runtimeB)
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
    stopA()
    stopB()
    a.dispose()
    b.dispose()
  })

  it('disposing one Runtime’s nodes leaves the other Runtime’s nodes fully usable', () => {
    const runtimeA = createRuntime()
    const runtimeB = createRuntime()
    const a = new Signal(1, runtimeA)
    const b = new Signal(1, runtimeB)
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
