import { describe, expect, it, vi } from 'vitest'
import { Effect, createRuntime } from '@migaia/reactive'
import { sharedInt32, sharedInt32Array } from '../src/shared-state'

function syncRuntime() {
  const runtime = createRuntime()
  runtime.setSchedulerStrategy((run) => run())
  return runtime
}

const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined'
const describeShared = hasSharedArrayBuffer ? describe : describe.skip

describeShared('Shared buffer runtime input boundary', () => {
  it('rejects an ArrayBuffer passed as a signal buffer', () => {
    expect(() => sharedInt32(createRuntime(), 0, new ArrayBuffer(8) as never)).toThrow(
      '[store] shared buffer must be a SharedArrayBuffer'
    )
  })

  it('rejects attaching a signal buffer as an array and vice versa', () => {
    const signal = sharedInt32(syncRuntime(), 3)
    expect(() => sharedInt32Array(syncRuntime(), 0, { buffer: signal.buffer })).toThrow()
    const array = sharedInt32Array(syncRuntime(), 1)
    expect(() => sharedInt32(syncRuntime(), 0, array.buffer)).toThrow()
    signal.dispose()
    array.dispose()
  })

  it('rejects null array options', () => {
    expect(() => sharedInt32Array(createRuntime(), 1, null as never)).toThrow(
      '[store] shared array options must be an object'
    )
  })
})

describeShared('SharedInt32Signal：跨 Runtime 共享一段内存', () => {
  it('prunes unobserved array cells after a high-churn observer is released', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 2)
    const observer = new Effect(() => void array.get(0), runtime)
    observer.dispose()
    expect(array.prune()).toBe(1)
    array.dispose()
  })

  it('propagates a write to a second runtime attached to the same buffer', () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32(writerRuntime, 1)
    const reader = sharedInt32(readerRuntime, 0, writer.buffer)

    // 附着到已有 buffer 时忽略 initialValue，直接看到对方已有的值
    expect(reader.peek()).toBe(1)

    let seen = 0
    let runs = 0
    const observer = new Effect(() => {
      runs++
      seen = reader.value
    }, readerRuntime)
    expect(seen).toBe(1)

    writer.value = 42
    // 另一个 Runtime 不共享调度器，必须显式 sync 才把远端写入拉进本地图
    expect(reader.isStale()).toBe(true)
    expect(reader.sync()).toBe(true)
    expect(seen).toBe(42)
    expect(reader.isStale()).toBe(false)
    // 已经同步过，重复 sync 不得再唤醒
    const before = runs
    expect(reader.sync()).toBe(false)
    expect(runs).toBe(before)

    observer.dispose()
    reader.dispose()
    writer.dispose()
  })

  it('does not bump anything when the same value is written back', () => {
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 5)
    let runs = 0
    const observer = new Effect(() => {
      runs++
      void signal.value
    }, runtime)

    signal.value = 5
    expect(runs).toBe(1)
    expect(signal.isStale()).toBe(false)

    signal.value = 6
    expect(runs).toBe(2)

    observer.dispose()
    signal.dispose()
  })

  it('rejects writes outside int32 instead of silently reshaping them', () => {
    // 之前这里钉的是 `value | 0` 的行为：3.9 存成 3，2**31 存成 -2**31。
    // 单线程里那叫「符合底层存储」，跨线程就是数据损坏——另一个线程读到的是
    // 调用方从未写过的数，而两边都没有任何错误。共享内存最难查的正是这种。
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 0)

    expect(() => (signal.value = 3.9)).toThrow('must be an int32')
    expect(() => (signal.value = 2_147_483_648)).toThrow('must be an int32')
    // 拒绝之后那格内存没被动过
    expect(signal.peek()).toBe(0)

    signal.value = 2_147_483_647
    expect(signal.peek()).toBe(2_147_483_647)

    signal.dispose()
  })

  it('refuses a buffer that cannot hold the value and version slots', () => {
    const runtime = syncRuntime()
    expect(() => sharedInt32(runtime, 0, new SharedArrayBuffer(4))).toThrow('buffer is too small')
  })

  it('refuses every access once disposed', () => {
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 1)
    signal.dispose()

    expect(signal.disposed).toBe(true)
    expect(() => signal.value).toThrow('shared signal is disposed')
    expect(() => signal.peek()).toThrow('shared signal is disposed')
    expect(() => signal.sync()).toThrow('shared signal is disposed')
    expect(() => {
      signal.value = 2
    }).toThrow('shared signal is disposed')
    expect(() => signal.dispose()).not.toThrow()
  })
})

describeShared('SharedInt32Array：逐下标失效', () => {
  it('materializes reactive cells only for tracked indexes', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 100_000)
    expect(array.get(99_999)).toBe(0)
    const observer = new Effect(() => void array.get(42), runtime)

    observer.dispose()
    array.dispose()
  })
  it('wakes only the observer that read the written index', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 4, {
      initialValues: [10, 20, 30, 40]
    })
    let firstRuns = 0
    let secondRuns = 0
    const first = new Effect(() => {
      firstRuns++
      array.get(0)
    }, runtime)
    const second = new Effect(() => {
      secondRuns++
      array.get(2)
    }, runtime)

    array.set(2, 99)
    expect(secondRuns).toBe(2)
    expect(firstRuns).toBe(1) // 读下标 0 的观察者不该被下标 2 的写入惊动
    expect(array.get(2)).toBe(99)

    first.dispose()
    second.dispose()
    array.dispose()
  })

  it('applies update() as a compare-and-swap loop', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 2, { initialValues: [1, 1] })

    expect(array.update(0, (current) => current + 4)).toBe(5)
    expect(array.get(0)).toBe(5)
    expect(array.get(1)).toBe(1)

    array.dispose()
  })

  it('rejects a non-function update callback before entering the CAS loop', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 1, { initialValues: [7] })

    expect(() => array.update(0, null as never)).toThrow(
      'shared array update callback must be a function'
    )
    expect(array.get(0)).toBe(7)

    array.dispose()
  })

  it('rejects an out-of-range or non-integer index', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 2)

    for (const index of [-1, 2, 1.5, Number.NaN]) {
      expect(() => array.get(index)).toThrow()
      expect(() => array.set(index, 1)).toThrow()
    }

    array.dispose()
  })

  it('contains symbol indexes in the tagged range error', () => {
    const array = sharedInt32Array(syncRuntime(), 1)
    expect(() => array.get(Symbol('index') as never)).toThrow(
      '[store] shared array index out of range: Symbol(index)'
    )
    array.dispose()
  })

  it('contains revoked array options proxies as tagged errors', () => {
    const { proxy, revoke } = Proxy.revocable({ buffer: undefined }, {})
    revoke()
    try {
      sharedInt32Array(syncRuntime(), 1, proxy as never)
      throw new Error('expected options to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-shared',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
  })

  it('materializes initial values before allocating and writing shared memory', () => {
    const initialValues = {
      *[Symbol.iterator](): IterableIterator<number> {
        yield 7
        throw new Error('initial iterator failure')
      }
    }
    expect(() => sharedInt32Array(syncRuntime(), 2, { initialValues })).toThrow(
      '[store] shared array initialValues could not be materialized safely'
    )
  })

  it('rejects an invalid length or an undersized buffer', () => {
    const runtime = syncRuntime()
    expect(() => sharedInt32Array(runtime, -1)).toThrow('non-negative integer')
    expect(() => sharedInt32Array(runtime, 1.5)).toThrow('non-negative integer')
    expect(() =>
      sharedInt32Array(runtime, 4, {
        buffer: new SharedArrayBuffer(8)
      })
    ).toThrow('buffer is too small')
    expect(() => sharedInt32Array(runtime, Number.MAX_SAFE_INTEGER)).toThrow(
      'exceeds the Int32Array capacity'
    )
  })

  it('shares one buffer between two runtimes', () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32Array(writerRuntime, 2, {
      initialValues: [7, 8]
    })
    const reader = sharedInt32Array(readerRuntime, 2, {
      buffer: writer.buffer
    })

    expect(reader.get(0)).toBe(7)
    writer.set(0, 70)
    // 数组版 sync() 报的是本次拉进来的下标个数，只有下标 0 变了
    expect(reader.sync()).toBe(1)
    expect(reader.get(0)).toBe(70)
    expect(reader.sync()).toBe(0)

    reader.dispose()
    writer.dispose()
  })

  it('ignores initialValues when attaching to an existing buffer', () => {
    // 与 SharedInt32Signal 的 initialValue 一样：附着已有 buffer 时那块内存已经
    // 有数据了，不该被 initialValues 覆盖（USEGUIDE §3.1 明确承诺的行为）。
    const runtime = syncRuntime()
    const writer = sharedInt32Array(runtime, 2, { initialValues: [1, 2] })

    const attached = sharedInt32Array(runtime, 2, {
      buffer: writer.buffer,
      initialValues: [99, 99]
    })
    expect(attached.get(0)).toBe(1)
    expect(attached.get(1)).toBe(2)

    attached.dispose()
    writer.dispose()
  })

  it('truncates initialValues beyond the array length instead of throwing', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 2, { initialValues: [1, 2, 3, 4] })

    expect(array.get(0)).toBe(1)
    expect(array.get(1)).toBe(2)

    array.dispose()
  })

  it('does not bump anything when the same value is written back via set()', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 1, { initialValues: [5] })
    let runs = 0
    const observer = new Effect(() => {
      runs++
      void array.get(0)
    }, runtime)

    array.set(0, 5)
    expect(runs).toBe(1)

    array.set(0, 6)
    expect(runs).toBe(2)

    observer.dispose()
    array.dispose()
  })

  it('rejects out-of-range int32 values from set() and update()', () => {
    // asInt32 是三条写入路径共用的同一道校验（USEGUIDE §4.3），此前只有
    // SharedInt32Signal.value 测过；set()/update() 这两条路径完全没测到。
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 1, { initialValues: [0] })

    expect(() => array.set(0, 3.9)).toThrow('must be an int32')
    expect(() => array.set(0, 2_147_483_648)).toThrow('must be an int32')
    expect(() => array.update(0, () => 2_147_483_648)).toThrow('must be an int32')
    // 拒绝之后那格没被动过
    expect(array.get(0)).toBe(0)

    array.dispose()
  })

  it('throws when update() keeps losing the CAS race indefinitely', () => {
    // update() 的重试上限和 readConsistent/acquire 共用 SPIN_LIMIT，但走它自己
    // 的错误消息（'kept losing the race'），此前完全没测到。用一个在 updater
    // 内部抢先落盘的“捣乱写者”制造出永远对不上期望值的 CAS，逼它耗尽重试。
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 1, { initialValues: [0] })
    let attempts = 0

    expect(() =>
      array.update(0, (current) => {
        attempts++
        array.writeCell(0, current + 999) // 无条件写，绕开 update() 自己的 CAS 期望值
        return current + 1
      })
    ).toThrow(/kept losing the race/)
    expect(attempts).toBe(1 << 16)

    array.dispose()
  })

  it('computes a snapshot of every index without mutating shared state', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 4, { initialValues: [1, 2, 3, 4] })

    const snap = array.snapshot()
    expect(Array.from(snap)).toEqual([1, 2, 3, 4])
    expect(snap).toBeInstanceOf(Int32Array)
    // 快照是普通内存的拷贝，不是共享内存的视图：改它不影响数组
    snap[0] = 999
    expect(array.get(0)).toBe(1)

    array.dispose()
  })

  it('refuses every access once disposed, and dispose() stays idempotent', () => {
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 2, { initialValues: [1, 2] })
    array.dispose()

    expect(array.disposed).toBe(true)
    expect(() => array.get(0)).toThrow('shared array is disposed')
    expect(() => array.set(0, 1)).toThrow('shared array is disposed')
    expect(() => array.update(0, (value) => value + 1)).toThrow('shared array is disposed')
    expect(() => array.sync()).toThrow('shared array is disposed')
    expect(() => array.watch()).toThrow('shared array is disposed')
    expect(() => array.snapshot()).toThrow('shared array is disposed')
    expect(() => array.prune()).toThrow('shared array is disposed')
    expect(() => array.dispose()).not.toThrow()
  })
})

describeShared('SharedInt32Array：multi-reader generation/cursor同步', () => {
  it('a full-array sync() only wakes observers on the indices that actually changed, across page boundaries', () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const length = 10_000
    const writer = sharedInt32Array(writerRuntime, length)
    const reader = sharedInt32Array(readerRuntime, length, {
      buffer: writer.buffer
    })

    // Scattered across different dirty pages (page size is an internal
    // implementation detail; these indices are far enough apart to land on
    // different pages under any reasonable page size).
    const touched = [3, 777, 5_001, 9_999]
    const runsByIndex = new Map<number, number>()
    const observers = touched.map((index) => {
      runsByIndex.set(index, 0)
      return new Effect(() => {
        runsByIndex.set(index, (runsByIndex.get(index) ?? 0) + 1)
        void reader.get(index)
      }, readerRuntime)
    })
    let untouchedRuns = 0
    const untouchedObserver = new Effect(() => {
      untouchedRuns++
      void reader.get(4_242)
    }, readerRuntime)

    for (const index of touched) writer.set(index, index * 2)
    expect(reader.sync()).toBe(touched.length)
    for (const index of touched) expect(reader.get(index)).toBe(index * 2)

    for (const index of touched) expect(runsByIndex.get(index)).toBe(2)
    expect(untouchedRuns).toBe(1) // unchanged cell version is not notified

    expect(reader.sync()).toBe(0) // idempotent: nothing left dirty

    for (const observer of observers) observer.dispose()
    untouchedObserver.dispose()
    reader.dispose()
    writer.dispose()
  })

  it("keeps independent reader cursors from consuming one another's updates", () => {
    const writerRuntime = syncRuntime()
    const firstReaderRuntime = syncRuntime()
    const secondReaderRuntime = syncRuntime()
    const length = 8
    const writer = sharedInt32Array(writerRuntime, length)
    const firstReader = sharedInt32Array(firstReaderRuntime, length, {
      buffer: writer.buffer
    })
    const secondReader = sharedInt32Array(secondReaderRuntime, length, {
      buffer: writer.buffer
    })

    writer.set(3, 1)
    expect(firstReader.sync()).toBe(1)
    expect(secondReader.sync()).toBe(1)
    writer.set(6, 2)
    expect(firstReader.sync()).toBe(1)
    expect(secondReader.sync()).toBe(1)
    expect(firstReader.get(6)).toBe(2)
    expect(secondReader.get(6)).toBe(2)

    firstReader.dispose()
    secondReader.dispose()
    writer.dispose()
  })
})

describeShared('seqlock：值与版本同源', () => {
  it('advances the version by two per committed write, and not at all when unchanged', () => {
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 0)
    const view = new BigInt64Array(signal.buffer, 24, 1)

    expect(Atomics.load(view, 0)).toBe(0n)
    signal.value = 5
    // 一次完成的写入把 seq 推进 2：偶数即「没人在写」，奇数是持锁中
    expect(Atomics.load(view, 0)).toBe(2n)
    signal.value = 5 // 相同值不该推进版本，否则每次 set 都通知一轮
    expect(Atomics.load(view, 0)).toBe(2n)
    signal.value = 6
    expect(Atomics.load(view, 0)).toBe(4n)

    signal.dispose()
  })

  it('keeps the 64-bit version beyond the old int32 range', () => {
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 0)
    const view = new BigInt64Array(signal.buffer, 24, 1)
    Atomics.store(view, 0, 2_147_483_646n)

    signal.value = 1
    expect(Atomics.load(view, 0)).toBe(2_147_483_648n)
    expect(signal.sync()).toBe(false)
    signal.dispose()
  })

  it('never reports a new value with a stale version', () => {
    // 旧布局是 exchange(value) 然后 add(version)：两步之间读者会看到
    // 「新值配旧版本」，据版本判断自己不脏，于是漏掉一次通知。
    // seqlock 下 value 与 version 必须同源——这里用两个附着同一 buffer 的
    // 实例模拟两条线程。
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32(writerRuntime, 0)
    const reader = sharedInt32(readerRuntime, 0, writer.buffer)

    expect(reader.isStale()).toBe(false)
    writer.value = 42
    // 值变了，版本必须同时变——否则下面这条会是 false，而读者永远醒不过来
    expect(reader.isStale()).toBe(true)
    expect(reader.peek()).toBe(42)
    expect(reader.sync()).toBe(true)
    expect(reader.isStale()).toBe(false)

    writer.dispose()
    reader.dispose()
  })

  it('publishes the remote generation before a local scheduler failure', () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32Array(writerRuntime, 1, { initialValues: [0] })
    const reader = sharedInt32Array(readerRuntime, 1, { buffer: writer.buffer })
    const observer = new Effect(() => {
      void writer.get(0)
    }, writerRuntime)
    const failure = new Error('local scheduler failed')

    writerRuntime.setSchedulerStrategy(() => {
      throw failure
    })

    expect(() => writer.set(0, 7)).toThrow(failure)
    // Remote readers must observe the committed generation even when local
    // notification throws after the write has become visible.
    expect(reader.sync()).toBe(1)
    expect(reader.get(0)).toBe(7)

    observer.dispose()
    reader.dispose()
    writer.dispose()
  })

  it('refuses to read or write forever when a writer died holding the lock', () => {
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 7)
    const view = new BigInt64Array(signal.buffer, 24, 1)

    // 手工制造「有人持锁后消失」：seq 停在奇数
    Atomics.store(view, 0, 1n)

    // 无限自旋会把这条线程也吊死，所以到限就抛，把「写坏了」暴露出来
    expect(() => signal.peek()).toThrow(/seqlock|never settled/)
    expect(() => {
      signal.value = 9
    }).toThrow(/seqlock|contention limit/)

    Atomics.store(view, 0, 2n)
    expect(signal.peek()).toBe(7)
    signal.dispose()
  })

  it('keeps the lock clean when an update callback throws', () => {
    // 持锁期间调用用户代码，一旦它抛错就留下一把奇数的死锁。所以回调在锁外跑。
    const runtime = syncRuntime()
    const array = sharedInt32Array(runtime, 2, { initialValues: [1, 2] })

    expect(() =>
      array.update(0, () => {
        throw new Error('user callback exploded')
      })
    ).toThrow('user callback exploded')

    // 锁没被弄脏：后续读写照常
    expect(array.get(0)).toBe(1)
    array.set(0, 10)
    expect(array.get(0)).toBe(10)

    array.dispose()
  })
})

describeShared('waitAsync 推送：远端写入不必靠 pump', () => {
  const canWaitAsync =
    typeof Atomics !== 'undefined' &&
    typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function'
  const maybe = canWaitAsync ? it : it.skip

  maybe('pushes a remote signal write into the local runtime', async () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32(writerRuntime, 0)
    const reader = sharedInt32(readerRuntime, 0, writer.buffer)

    const seen: number[] = []
    const observer = new Effect(() => {
      seen.push(reader.value)
    }, readerRuntime)
    const stop = reader.watch()

    writer.value = 3
    // 没有任何手动 sync()：唤醒回路自己把远端写入拉进来
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(seen).toEqual([0, 3])
    stop()
    observer.dispose()
    writer.dispose()
    reader.dispose()
  })

  maybe('contains a throwing runtime reporter for waitAsync failures', async () => {
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 0)
    const reporterFailure = new Error('runtime reporter failed')
    const waitFailure = new Error('waitAsync failed')
    const hostReportError = vi.fn()
    const atomics = Atomics as unknown as {
      waitAsync: (view: Int32Array, index: number, value: number) => unknown
    }
    const originalWaitAsync = atomics.waitAsync
    vi.spyOn(runtime, 'reportError').mockImplementation(() => {
      throw reporterFailure
    })
    vi.stubGlobal('reportError', hostReportError)
    atomics.waitAsync = vi.fn(() => ({ async: true, value: Promise.reject(waitFailure) }))
    try {
      const stop = signal.watch()
      await vi.waitFor(() => expect(hostReportError).toHaveBeenCalledWith(reporterFailure))
      stop()
    } finally {
      atomics.waitAsync = originalWaitAsync
      vi.unstubAllGlobals()
      signal.dispose()
    }
  })

  maybe('wakes one loop for the whole array and touches only the changed cell', async () => {
    // 一格一个 waiter 在长数组上不可行，所以等的是头部 epoch，醒来再扫。
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32Array(writerRuntime, 4, {
      initialValues: [0, 0, 0, 0]
    })
    const reader = sharedInt32Array(readerRuntime, 4, {
      buffer: writer.buffer
    })

    let cell1Runs = 0
    let cell3Runs = 0
    let cell3Value = -1
    const watcher1 = new Effect(() => {
      cell1Runs++
      reader.get(1)
    }, readerRuntime)
    const watcher3 = new Effect(() => {
      cell3Runs++
      cell3Value = reader.get(3)
    }, readerRuntime)
    const stop = reader.watch()

    writer.set(3, 99)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(cell3Value).toBe(99)
    expect(cell3Runs).toBe(2)
    // 只有真正变了的那格通知它自己的观察者
    expect(cell1Runs).toBe(1)

    stop()
    watcher1.dispose()
    watcher3.dispose()
    writer.dispose()
    reader.dispose()
  })

  maybe('stops pushing once the loop is stopped', async () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32(writerRuntime, 0)
    const reader = sharedInt32(readerRuntime, 0, writer.buffer)

    const seen: number[] = []
    const observer = new Effect(() => {
      seen.push(reader.value)
    }, readerRuntime)
    const stop = reader.watch()
    stop()

    writer.value = 5
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 回路停了：远端写入不再被推进来（值仍在内存里，要 sync 才看得到）
    expect(seen).toEqual([0])
    expect(reader.sync()).toBe(true)
    expect(seen).toEqual([0, 5])

    // 先释放观察者再释放信号：dispose 会断边并让下游重跑，顺序反了会读到已释放的信号
    observer.dispose()
    reader.dispose()
    writer.dispose()
  })

  maybe('stops pushing when the signal is disposed', async () => {
    const writerRuntime = syncRuntime()
    const readerRuntime = syncRuntime()
    const writer = sharedInt32(writerRuntime, 0)
    const reader = sharedInt32(readerRuntime, 0, writer.buffer)

    let wakes = 0
    reader.watch()
    const stopCounting = new Effect(() => {
      wakes++
      reader.peek()
    }, readerRuntime)
    reader.dispose()

    writer.value = 7
    await new Promise((resolve) => setTimeout(resolve, 20))

    // dispose 之后回路必须停：否则它会一直去 sync 一个已释放的信号
    expect(wakes).toBe(1)
    stopCounting.dispose()
    writer.dispose()
  })

  maybe('returns the same stop function on repeated watch() calls', () => {
    // USEGUIDE §3.2/§5：重复调用 watch() 不应叠加第二条回路，而是复用同一个
    // 停止函数。此前只测过“stop 一次就彻底停”，没测过“调用两次不是两条回路”。
    const runtime = syncRuntime()
    const signal = sharedInt32(runtime, 0)
    const array = sharedInt32Array(runtime, 2)

    const firstSignalStop = signal.watch()
    expect(signal.watch()).toBe(firstSignalStop)
    const firstArrayStop = array.watch()
    expect(array.watch()).toBe(firstArrayStop)

    firstSignalStop()
    firstArrayStop()
    signal.dispose()
    array.dispose()
  })

  maybe('makes the returned stop disposer idempotent', () => {
    const notify = vi.spyOn(Atomics, 'notify')
    const signal = sharedInt32(syncRuntime(), 0)
    const stop = signal.watch()
    notify.mockClear()

    stop()
    stop()

    expect(notify).toHaveBeenCalledTimes(1)
    signal.dispose()
    notify.mockRestore()
  })

  it('throws instead of silently falling back to polling when Atomics.waitAsync is unavailable', () => {
    // USEGUIDE §5/§8 明确承诺：环境不支持 waitAsync 时 watch() 直接抛错，而不是
    // 静默退化成轮询。此前完全没有测过这条分支——不依赖当前环境是否真的支持
    // waitAsync，而是临时摘掉它来模拟“不支持”的环境。
    const original = (Atomics as unknown as { waitAsync?: unknown }).waitAsync
    delete (Atomics as unknown as { waitAsync?: unknown }).waitAsync
    try {
      const runtime = syncRuntime()
      const signal = sharedInt32(runtime, 0)
      expect(() => signal.watch()).toThrow('Atomics.waitAsync is unavailable')
      signal.dispose()

      const array = sharedInt32Array(runtime, 2)
      expect(() => array.watch()).toThrow('Atomics.waitAsync is unavailable')
      array.dispose()
    } finally {
      if (original !== undefined) {
        ;(Atomics as unknown as { waitAsync: unknown }).waitAsync = original
      }
    }
  })
})
