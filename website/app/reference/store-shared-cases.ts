import type { ICaseDoc, IText } from './contract.js'

/** Pairs the reader-facing explanations without changing executable examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete public-entry examples with deterministic output and explicit local ownership. */
export const storeSharedCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  sharedInt32: [
    {
      title: t('Attach a reader without overwriting shared state', '附着读者而不覆盖共享值'),
      problem: t(
        'A worker updates an integer, but another Runtime still needs to publish that change to its own graph. A direct read of shared bytes is different from acknowledging a notification.\n\nCopying a value creates a second counter, while cloning the JavaScript wrapper cannot recreate its subscriptions. Treating peek() as synchronization also leaves the local version cursor unchanged.\n\nInstall @migaia/store-shared and @migaia/reactive directly. sharedInt32 attaches through buffer, ignores the supplied initial value, and lets each reader explicitly sync its own cursor.',
        '另一个线程更新整数后，本地运行时仍须把变化发布给自己的依赖图；直接读到共享字节，不等于已经确认通知。\n\n复制数值会产生第二个计数器，克隆 JavaScript 包装也不能重建订阅；把 `peek()` 当成同步还会让本地版本游标保持不变。\n\n直接安装 `@migaia/store-shared` 和 `@migaia/reactive`；`sharedInt32` 通过 `buffer` 附着并忽略所传初值，各读者用 `sync()` 推进自己的游标。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32 } from '@migaia/store-shared'\n\nconst writer = sharedInt32(createRuntime(), 7)\nconst reader = sharedInt32(createRuntime(), 999, writer.buffer)\nconsole.log(reader.peek())\nwriter.value = 9\nconsole.log(reader.peek(), reader.isStale())\nconsole.log(reader.sync(), reader.sync())\nwriter.dispose()\nconsole.log(reader.peek())\nreader.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32 } from '@migaia/store-shared'\n\nconst writer = sharedInt32(createRuntime(), 7)\nconst reader = sharedInt32(createRuntime(), 999, writer.buffer)\nconsole.log(reader.peek())\nwriter.value = 9\nconsole.log(reader.peek(), reader.isStale())\nconsole.log(reader.sync(), reader.sync())\nwriter.dispose()\nconsole.log(reader.peek())\nreader.dispose()"
      ),
      result: t(
        'Prints four lines: `7`, `9 true`, `true false`, then `9`. The attachment preserves 7; peek sees 9 while the cursor is stale; only the first sync acknowledges it.\n\nEach wrapper owns its local graph and lifetime; disposing the writer leaves the attached reader usable. peek() does not track or publish. Without watch(), readers choose when to sync; this example uses two Runtimes in one process.',
        '逐行输出 `7`、`9 true`、`true false`、`9`；附着保留原值，`peek()` 读到新值时游标仍过期，仅首次 `sync()` 确认变化。\n\n每个包装独立拥有本地图与生命周期，销毁写者不影响附着读者；`peek()` 不追踪、不发布，未启用 `watch()` 时由读者安排同步，本例在同一进程创建两个运行时。'
      )
    },
    {
      title: t('Skip unchanged writes and reject invalid integers', '跳过同值写入并拒绝非法整数'),
      problem: t(
        'A counter observer should rerun for a changed integer, while a repeated assignment should not produce another update. Invalid input must not silently become a different shared value.\n\nUnconditional notifications repeat work for unchanged state. Coercing with bitwise operators truncates fractions and wraps large numbers, hiding the fact that the caller supplied an unsupported value.\n\nsharedInt32 validates int32 writes and skips equal values. The createRuntime schedulerStrategy option runs effects synchronously here for deterministic output; it belongs to reactive, and store-shared does not change Runtime scheduling.',
        '计数器观察者应在整数变化时重新执行，而重复赋相同值不应产生额外更新；非法输入也不应悄悄变成另一个共享值。\n\n无条件通知会为未变状态重复工作，位运算强制转换则会截断小数、回绕大整数，掩盖调用者提供了不支持的值。\n\n`sharedInt32` 校验 `int32` 写入并跳过同值；本例用响应包 `createRuntime` 的 `schedulerStrategy` 同步执行效果以固定输出，共享包不拥有或修改运行时调度。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32 } from '@migaia/store-shared'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst counter = sharedInt32(runtime, 5)\nlet runs = 0\nconst observer = runtime.effect(() => {\n  runs++\n  void counter.value\n})\ncounter.value = 5\nconsole.log(runs, counter.peek())\ntry {\n  counter.value = 1.5\n} catch (error) {\n  console.log(error instanceof RangeError, (error as { code: string }).code)\n}\nconsole.log(counter.peek())\ncounter.value = 6\nconsole.log(runs, counter.peek())\nobserver.dispose()\ncounter.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32 } from '@migaia/store-shared'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst counter = sharedInt32(runtime, 5)\nlet runs = 0\nconst observer = runtime.effect(() => {\n  runs++\n  void counter.value\n})\ncounter.value = 5\nconsole.log(runs, counter.peek())\ntry {\n  counter.value = 1.5\n} catch (error) {\n  console.log(error instanceof RangeError, (error as { code: string }).code)\n}\nconsole.log(counter.peek())\ncounter.value = 6\nconsole.log(runs, counter.peek())\nobserver.dispose()\ncounter.dispose()"
      ),
      result: t(
        'Prints `1 5`, `true INVALID_OPTION`, `5`, and `2 6` on separate lines. The same-value assignment and rejected fractional write leave both the stored value and effect count unchanged.\n\nValid writes are integers from -2147483648 through 2147483647. A changed commit publishes locally; equal writes do not advance the shared version. The supplied Runtime controls when notified effects execute.',
        '逐行输出 `1 5`、`true INVALID_OPTION`、`5`、`2 6`；同值赋值及被拒绝的小数写入都未改变存储值或效果执行次数。\n\n合法写入为 `[-2147483648, 2147483647]` 内的整数，变化提交会本地发布，同值写入不推进共享版本，收到通知后的效果执行时机由传入的运行时控制。'
      )
    }
  ],
  sharedInt32Array: [
    {
      title: t('Notify only the index an observer reads', '只通知读取对应下标的观察者'),
      problem: t(
        'A shared array holds several independent coordinates. Updating one coordinate should refresh its observer while leaving a reader of another index alone.\n\nObserving one whole-array revision makes every coordinate change invalidate every subscriber. Adding a separate dependency table duplicates ownership and cleanup that the Runtime already manages.\n\nsharedInt32Array tracks get(index) per index inside effects. This example installs reactive directly and uses its Runtime schedulerStrategy option for synchronous presentation; that option is not a shared-array constructor field.',
        '共享数组存放多个独立坐标，更新其中一项应刷新对应观察者，同时保留其他下标读者的状态。\n\n只观察整数组版本会让任意坐标变化都使全部订阅者失效，另建依赖表又会重复运行时已有的归属与清理职责。\n\n`sharedInt32Array` 在效果内按 `get(index)` 追踪下标；本例直接安装响应包，用其运行时 `schedulerStrategy` 同步展示，该选项不是共享数组构造字段。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32Array } from '@migaia/store-shared'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst coordinates = sharedInt32Array(runtime, 2, { initialValues: [10, 20] })\nlet firstRuns = 0\nlet secondRuns = 0\nconst first = runtime.effect(() => {\n  firstRuns++\n  void coordinates.get(0)\n})\nconst second = runtime.effect(() => {\n  secondRuns++\n  void coordinates.get(1)\n})\ncoordinates.set(1, 22)\nconsole.log(firstRuns, secondRuns)\ncoordinates.set(1, 22)\nconsole.log(firstRuns, secondRuns)\ncoordinates.update(0, (current) => current + 1)\nconsole.log(firstRuns, secondRuns)\nfirst.dispose()\nsecond.dispose()\ncoordinates.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32Array } from '@migaia/store-shared'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst coordinates = sharedInt32Array(runtime, 2, { initialValues: [10, 20] })\nlet firstRuns = 0\nlet secondRuns = 0\nconst first = runtime.effect(() => {\n  firstRuns++\n  void coordinates.get(0)\n})\nconst second = runtime.effect(() => {\n  secondRuns++\n  void coordinates.get(1)\n})\ncoordinates.set(1, 22)\nconsole.log(firstRuns, secondRuns)\ncoordinates.set(1, 22)\nconsole.log(firstRuns, secondRuns)\ncoordinates.update(0, (current) => current + 1)\nconsole.log(firstRuns, secondRuns)\nfirst.dispose()\nsecond.dispose()\ncoordinates.dispose()"
      ),
      result: t(
        'Prints `1 2`, `1 2`, then `2 2`. Index 1 wakes only its reader, writing 22 again wakes neither reader, and updating index 0 wakes only the first.\n\nTracking materializes a source only for the read index; untracked get() reads shared memory directly. Disposing the effects releases their subscriptions, and array disposal releases the remaining local sources.',
        '逐行输出 `1 2`、`1 2`、`2 2`；下标 `1` 只唤醒自己的读者，再写 `22` 不唤醒任何读者，更新下标 `0` 只唤醒第一个读者。\n\n追踪只为被读下标物化图源，追踪外的 `get()` 直接读共享内存；销毁效果释放订阅，销毁数组释放其余本地图源。'
      )
    },
    {
      title: t('Let every reader synchronize independently', '让每个读者独立同步'),
      problem: t(
        'Two consumers read the same shared array. Both need to detect a writer update, even if the first consumer has already completed its synchronization pass.\n\nA shared dirty flag that the first reader clears consumes the notification for everyone else. Reading current bytes alone does not establish which cell versions each consumer has acknowledged.\n\nsharedInt32Array gives every attached wrapper its own generation and cell cursors. Share only buffer, preserve the same fixed length, and call sync() separately for each reader; reactive is a direct installation requirement.',
        '两个消费者读取同一共享数组，即使第一个消费者已经完成同步，第二个也仍须检测到写者的更新。\n\n由首个读者清除的共享脏标志会消费其他人的通知，仅读取当前字节也无法记录各消费者已经确认哪些格版本。\n\n`sharedInt32Array` 为各附着包装保留自己的代次与格游标，共享 `buffer` 并保持相同固定长度，各读者分别调用 `sync()`，响应包须直接安装。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32Array } from '@migaia/store-shared'\n\nconst writer = sharedInt32Array(createRuntime(), 3)\nconst first = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })\nconst second = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })\nwriter.set(0, 7)\nwriter.set(2, 9)\nconsole.log(first.sync(), second.sync())\nconsole.log(first.sync(), second.sync())\nconsole.log(JSON.stringify(Array.from(second.snapshot())))\nfirst.dispose()\nsecond.dispose()\nwriter.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { sharedInt32Array } from '@migaia/store-shared'\n\nconst writer = sharedInt32Array(createRuntime(), 3)\nconst first = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })\nconst second = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })\nwriter.set(0, 7)\nwriter.set(2, 9)\nconsole.log(first.sync(), second.sync())\nconsole.log(first.sync(), second.sync())\nconsole.log(JSON.stringify(Array.from(second.snapshot())))\nfirst.dispose()\nsecond.dispose()\nwriter.dispose()"
      ),
      result: t(
        'Prints `2 2`, `0 0`, and `[7,0,9]` on separate lines. Each reader counts both changed cells independently; repeating a full sync without another write reports zero.\n\nFull sync counts changed indices even without observers. It returns immediately when its generation is unchanged; otherwise it scans length cells and batches local notifications. sync(index) limits the comparison to one index and returns 0 or 1.',
        '逐行输出 `2 2`、`0 0`、`[7,0,9]`；每个读者独立计入两个变化格，没有新写入时再次完整同步均返回零。\n\n完整 `sync()` 也计入没有观察者的变化下标，代次未变时直接返回，否则扫描 `length` 个格并批处理本地通知；`sync(index)` 只比较指定格，返回 `0` 或 `1`。'
      )
    }
  ],
  SharedInt32Array: [
    {
      title: t('Keep the cell usable after an updater fails', '更新回调失败后仍可使用共享格'),
      problem: t(
        'An updater can reject application data while computing a new integer. The caller needs the original failure and must still be able to update the same shared cell afterward.\n\nExecuting application callbacks while a seqlock is held lets a throw abandon an odd locked version. Wrapping every failure in a fresh error also loses the original native error identity.\n\nSharedInt32Array.update computes outside the lock and then attempts an expected-value commit. The example throws a prebuilt local TypeError before committing, then performs a pure increment; install reactive directly for createRuntime.',
        '更新回调计算新整数时可能拒绝应用数据，调用者既需要原始失败，也需要随后继续更新同一个共享格。\n\n在持有序列锁时执行应用回调，会让抛错留下奇数锁版本；每次失败都重新包装错误还会丢失原生错误身份。\n\n`SharedInt32Array.update` 在锁外计算再尝试期望值提交，本例提交前抛出预建的本地 `TypeError`，随后用纯函数递增，并直接安装响应包以取得 `createRuntime`。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { SharedInt32Array } from '@migaia/store-shared'\n\nconst values = new SharedInt32Array(createRuntime(), 1, { initialValues: [7] })\nconst original = new TypeError('invalid increment')\ntry {\n  values.update(0, () => {\n    throw original\n  })\n} catch (error) {\n  console.log(error === original, error instanceof TypeError, (error as { code: string }).code)\n}\nconsole.log(values.get(0))\nconsole.log(values.update(0, (current) => current + 1))\nvalues.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { SharedInt32Array } from '@migaia/store-shared'\n\nconst values = new SharedInt32Array(createRuntime(), 1, { initialValues: [7] })\nconst original = new TypeError('invalid increment')\ntry {\n  values.update(0, () => {\n    throw original\n  })\n} catch (error) {\n  console.log(error === original, error instanceof TypeError, (error as { code: string }).code)\n}\nconsole.log(values.get(0))\nconsole.log(values.update(0, (current) => current + 1))\nvalues.dispose()"
      ),
      result: t(
        'Prints `true true UPDATE_FAILED`, `7`, and `8` on separate lines. The thrown object is the original TypeError; the failed callback commits nothing, and the next update completes on the same cell.\n\nUnclassified extensible native errors are tagged in place; frozen or non-Error failures remain on cause, and complete foreign identities keep their owner. A contending update may retry its callback, so successful callbacks must be pure and repeatable.',
        '逐行输出 `true true UPDATE_FAILED`、`7`、`8`；抛出对象就是原始 `TypeError`，失败回调没有提交，随后同格更新仍能完成。\n\n未编码且可扩展的原生错误原位附码，冻结或非错误值保留在 `cause`，完整外包身份保留原归属；争用可能重调更新回调，成功回调须纯净且可重复。'
      )
    },
    {
      title: t('Copy values without exposing shared storage', '复制数值而不暴露共享存储'),
      problem: t(
        'An exporter needs a local array it can edit without changing the live shared state. Later shared writes should also leave that earlier copy unchanged.\n\nCreating another typed-array view over shared backing still aliases the same bytes. Treating a multi-cell read as a transaction can also imply consistency across cells that independent writers do not provide.\n\nSharedInt32Array.snapshot allocates a separate nonshared Int32Array and consistently reads each cell into it. Construct the array with a reactive Runtime from the directly installed reactive package, then keep or modify the returned copy.',
        '导出流程需要一份可编辑且不影响实时共享状态的本地数组，随后共享写入也不应改变此前副本。\n\n在共享底层上另建类型数组视图仍会引用同一字节，把多格读取当事务还会暗示独立写者并不提供的跨格一致性。\n\n`SharedInt32Array.snapshot` 分配独立的非共享 `Int32Array` 并逐格一致读入，先用直接安装的响应包运行时构造数组，再保留或修改返回副本。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { SharedInt32Array } from '@migaia/store-shared'\n\nconst values = new SharedInt32Array(createRuntime(), 2, { initialValues: [4, 5] })\nconst copy = values.snapshot()\nconsole.log(JSON.stringify(Array.from(copy)))\ncopy[0] = 99\nvalues.set(1, 8)\nconsole.log(JSON.stringify(Array.from(copy)), JSON.stringify(Array.from(values.snapshot())))\nconsole.log(copy.buffer instanceof SharedArrayBuffer)\nvalues.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { SharedInt32Array } from '@migaia/store-shared'\n\nconst values = new SharedInt32Array(createRuntime(), 2, { initialValues: [4, 5] })\nconst copy = values.snapshot()\nconsole.log(JSON.stringify(Array.from(copy)))\ncopy[0] = 99\nvalues.set(1, 8)\nconsole.log(JSON.stringify(Array.from(copy)), JSON.stringify(Array.from(values.snapshot())))\nconsole.log(copy.buffer instanceof SharedArrayBuffer)\nvalues.dispose()"
      ),
      result: t(
        'Prints `[4,5]`, `[99,5] [4,8]`, and `false` on separate lines. Editing the copy does not change shared index 0, and writing shared index 1 does not change the earlier copy.\n\nThe result is caller-owned ordinary memory. Each cell is read consistently, but concurrent writes can occur between different cell reads; snapshot() does not promise an atomic whole-array transaction.',
        '逐行输出 `[4,5]`、`[99,5] [4,8]`、`false`；修改副本未改变共享下标 `0`，写入共享下标 `1` 也未改变此前副本。\n\n返回结果是调用者拥有的普通内存，各格分别一致读取，但不同格的读取之间可能发生并发写入，`snapshot()` 不承诺整数组原子事务。'
      )
    }
  ]
}
