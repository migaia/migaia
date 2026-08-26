import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '../src'
import { deferred, flushAsync } from './helpers'

/**
 * M-T7（`docs/lifecycle/migration.sdd.md` §8.5，批次 2 的核心验收项）。
 *
 * `Resource` 有两条**互相正交**的代数，迁移到 `@migaia/lifecycle` 的 `GenerationController` 之后必须 保持不混：
 *
 * 1. **请求代数**（现由 `createGenerationController()` 承载）—— 判定「这次异步结果还该不该提交」。
 * 2. **观察/挂起代数**（仍是本地的 `#suspensionGeneration`）—— 判定「这次延迟挂起还该不该真的断上游边」。
 *
 * §7 批次 2 明文要求「保留 request generation 与 observation/suspension generation 两条正交代数」；
 * 一旦合并成一条，观察者的来去会误作废在途请求，或者一次陈旧的挂起会把已被重新观察的资源断边。
 */
describe('M-T7 (§7 批次 2): request generation and suspension generation stay orthogonal', () => {
  it('an in-flight request still commits even though observers attached and detached while it ran', async () => {
    const runtime = createRuntime()
    const blocking = deferred<number>()
    const resource = new Resource(() => blocking.promise, runtime)

    // 观察窗口在请求在途期间开合一次：suspension 代数前进两次，请求代数一次都不该动。
    const stop = runtime.effect(() => {
      expect(resource.state).toBeDefined()
    })
    stop()

    blocking.resolve(42)
    await flushAsync()

    expect(resource.state).toEqual({ status: 'success', data: 42 })
    resource.dispose()
  })

  it('a stale suspension scheduled before re-observation does not disconnect the re-observed resource', async () => {
    const runtime = createRuntime()
    const dep = runtime.signal(1)
    const resource = new Resource(() => dep.value * 10, runtime)
    // 必须在结算前就开始观察：autoStart 后从未被观察的 Resource 会在结算时主动休眠并断边，
    // 那是观察轴的正常行为（见下面的 positive control），不是本条要验的东西。
    const stopFirst = runtime.effect(() => {
      expect(resource.state).toBeDefined()
    })
    await flushAsync()
    expect(resource.state).toEqual({ status: 'success', data: 10 })
    expect(resource.deps.size).toBeGreaterThan(0)

    stopFirst() // 排一次挂起（挂起代数 N）
    const stopSecond = runtime.effect(() => {
      expect(resource.state).toBeDefined()
    })
    // 重新被观察 → 挂起代数变成 N+1，那次排好的 N 必须自行作废。
    await flushAsync()

    expect(resource.deps.size).toBeGreaterThan(0)

    // 上游边还在 → 依赖变化仍能驱动一次新请求（请求代数照常推进）。
    dep.value = 2
    await flushAsync()
    expect(resource.state).toEqual({ status: 'success', data: 20 })

    stopSecond()
    resource.dispose()
  })

  it('positive control: left genuinely unobserved, the suspension does disconnect (the test above is not vacuous)', async () => {
    const runtime = createRuntime()
    const dep = runtime.signal(1)
    const resource = new Resource(() => dep.value * 10, runtime)
    const stop = runtime.effect(() => {
      expect(resource.state).toBeDefined()
    })
    await flushAsync()
    expect(resource.deps.size).toBeGreaterThan(0)

    stop() // 排一次挂起，且不再重新观察
    await flushAsync()

    expect(resource.deps.size).toBe(0)
    resource.dispose()
  })

  it('cancelling a request (request axis) leaves the dependency edges (observation axis) untouched', async () => {
    const runtime = createRuntime()
    const dep = runtime.signal(3)
    const blocking = deferred<number>()
    const resource = new Resource(() => {
      expect(dep.value).toBe(3) // 同步读取 → 建立上游边
      return blocking.promise
    }, runtime)
    const promise = resource.promise
    expect(resource.deps.size).toBeGreaterThan(0)

    resource.cancel()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    // 取消的是请求代数，不该顺手把观察侧的上游边一起断掉。
    expect(resource.deps.size).toBeGreaterThan(0)
    expect(resource.state.status).toBe('cancelled')
    resource.dispose()
  })

  it('a superseded request never overwrites the newer generation’s result', async () => {
    const runtime = createRuntime()
    const first = deferred<number>()
    const second = deferred<number>()
    let call = 0
    const resource = new Resource(() => {
      call++
      return call === 1 ? first.promise : second.promise
    }, runtime)

    const superseded = resource.promise
    void superseded.catch(() => undefined)
    const refetched = resource.refetch() // 请求代数 +1，第一次请求作废

    second.resolve(2)
    await refetched
    first.resolve(1) // 迟到的旧代数结果
    await flushAsync()

    expect(resource.state).toEqual({ status: 'success', data: 2 })
    resource.dispose()
  })
})
