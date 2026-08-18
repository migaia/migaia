# 使用手册

本文是 `@migaia/store-shared` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、五分钟怎么跑起来"，本文讲"每一个 API 的精确签名、内部机制、边界行为"。

## 目录

1. [导入与前置条件](#1-导入与前置条件)
2. [`SharedInt32Signal` 完整参考](#2-sharedint32signal-完整参考)
3. [`SharedInt32Array` 完整参考](#3-sharedint32array-完整参考)
4. [Seqlock：并发读写的正确性保证](#4-seqlock并发读写的正确性保证)
5. [跨线程同步：`sync()` 与 `watch()`](#5-跨线程同步sync-与-watch)
6. [脏页 bitmap：`SharedInt32Array` 的稀疏同步](#6-脏页-bitmapsharedint32array-的稀疏同步)
7. [响应式集成细节](#7-响应式集成细节)
8. [错误一览表](#8-错误一览表)
9. [生产环境完整示例](#9-生产环境完整示例)
10. [常见问题排查](#10-常见问题排查)
11. [构建、格式化与测试](#11-构建格式化与测试)

---

## 1. 导入与前置条件

```ts
import { createRuntime } from '@migaia/reactive';
import { sharedInt32, sharedInt32Array, SharedInt32Signal, SharedInt32Array } from '@migaia/store-shared';
```

两个工厂函数 `sharedInt32`/`sharedInt32Array` 是推荐的创建方式；`SharedInt32Signal`/`SharedInt32Array` 类本身也导出，供需要 `instanceof` 判断或类型标注的场景使用。

使用前必须先有一个 `@migaia/reactive` 的 `Runtime`（`createRuntime()` 的返回值）——每个共享对象构造时都会向传入的 `Runtime` 登记归属，且构造过程会读取该 `Runtime` 的内部版本时钟。

**运行环境要求**：`SharedArrayBuffer` 在浏览器里通常需要页面处于[跨源隔离](https://developer.mozilla.org/en-US/docs/Web/API/crossOriginIsolated)状态（`COOP`/`COEP` 响应头）才可用；Node.js/Bun/Deno 默认可用。`.watch()` 额外要求 `Atomics.waitAsync` 存在，浏览器主线程和部分运行时可能不支持，见 [§5](#5-跨线程同步sync-与-watch)。

---

## 2. `SharedInt32Signal` 完整参考

### 2.1 构造

```ts
sharedInt32(runtime: IRuntime, initialValue?: number, buffer?: SharedArrayBuffer): SharedInt32Signal
new SharedInt32Signal(runtime, initialValue?, buffer?)
```

| 参数 | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `runtime` | `IRuntime` | 必填 | 无 | 该信号归属的 `Runtime`，决定它在哪张响应式图里被追踪、通知 |
| `initialValue` | `number` | 可选 | `0` | 新建 buffer 时写入的初始值，必须是合法 `int32`；**传了 `buffer` 时此参数被忽略** |
| `buffer` | `SharedArrayBuffer` | 可选 | 新建一块 | 传入已有 buffer 表示"附着"到另一个实例已经在用的那块内存，两边此后读写同一份数据 |

未传 `buffer` 时会新建一个大小为 `2 * Int32Array.BYTES_PER_ELEMENT`（8 字节）的 `SharedArrayBuffer`；传入的 `buffer` 若小于这个尺寸，构造函数抛 `RangeError('[store] shared signal buffer is too small')`。

### 2.2 属性与方法

| 成员 | 类型/签名 | 同步/异步 | 说明 |
| --- | --- | --- | --- |
| `runtime` | `IRuntime`（只读字段） | — | 构造时传入的 `Runtime` |
| `buffer` | `SharedArrayBuffer`（只读字段） | — | 底层共享内存，用于传给另一个线程/`Runtime` |
| `disposed` | `boolean`（getter） | 同步 | 是否已释放 |
| `version` | `number`（getter） | 同步 | 该节点在所属 `Runtime` 响应式图里的版本号（不是共享内存里的 seq，是包一层 `readVersion` 之后的图内版本） |
| `value` | `number`（getter/setter） | 同步 | 读：触发一致读 + `sync()` + 依赖追踪；写：写入合法 int32，本地静默不变值不通知 |
| `peek()` | `() => number` | 同步 | 读当前值，**不**触发依赖追踪、**不**主动拉取远端更新（读的是上一次已知的本地状态） |
| `sync()` | `() => boolean` | 同步 | 主动检查共享内存里的版本号是否变化，变了则更新本地记录并通知观察者，返回是否发生了变化 |
| `watch()` | `() => IDisposer` | 同步 | 起一条基于 `Atomics.waitAsync` 的自动唤醒回路；重复调用返回同一个停止函数；`dispose()` 也会停止它 |
| `dispose()` | `() => void` | 同步 | 停止 `watch()` 回路、从响应式图断开；幂等 |

`value` 的 getter 内部顺序是：先做一次一致读拿到 value + version → 若发现共享内存里的 version 和本地记录不一致就 `sync()`（触发通知）→ 向当前 `Runtime` 的依赖追踪器登记依赖 → 返回值。也就是说**在 `Effect`/`Computed` 里读 `.value` 会自动追踪，并且会顺带把远端的最新写入拉进来**，不需要额外调用 `sync()`。

写入 `.value = next` 时，若 `next` 与当前值相同，写入被跳过（不推进版本号、不触发本地通知、也不唤醒远端 `watch()`），避免"重复写相同值"引发无意义的通知风暴。

---

## 3. `SharedInt32Array` 完整参考

### 3.1 构造

```ts
sharedInt32Array(
  runtime: IRuntime,
  length: number,
  options?: { buffer?: SharedArrayBuffer; initialValues?: Iterable<number> }
): SharedInt32Array
```

| 参数 | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `runtime` | `IRuntime` | 必填 | 无 | 归属的 `Runtime` |
| `length` | `number` | 必填 | 无 | 数组长度，必须是非负整数，否则抛 `RangeError('[store] shared array length must be a non-negative integer')` |
| `options.buffer` | `SharedArrayBuffer` | 可选 | 新建一块 | 附着到已有 buffer；传了此项时 `initialValues` 被忽略 |
| `options.initialValues` | `Iterable<number>` | 可选 | 无 | 仅新建 buffer 时生效，按顺序写入前 N 个下标（超过 `length` 的部分被丢弃） |

所需 buffer 大小由 `length` 推导（头部 epoch slot + 脏页 bitmap words + 每格 2 个 slot），传入的 buffer 不足会抛 `RangeError('[store] shared array buffer is too small')`。构造函数**不会**在启动时扫描全部格子的 seqlock——每个下标的响应式基线在第一次被追踪读取时才建立，数组级的 `sync()` 依赖 epoch 判断要不要扫描，见 [§6](#6-脏页-bitmapsharedint32array-的稀疏同步)。

### 3.2 属性与方法

| 成员 | 类型/签名 | 同步/异步 | 说明 |
| --- | --- | --- | --- |
| `runtime` | `IRuntime`（只读字段） | — | 归属的 `Runtime` |
| `buffer` | `SharedArrayBuffer`（只读字段） | — | 底层共享内存 |
| `length` | `number`（只读字段） | — | 数组长度，构造后不可变 |
| `disposed` | `boolean`（getter） | 同步 | 是否已释放 |
| `get(index)` | `(index: number) => number` | 同步 | 读取下标 `index`；若当前处于依赖追踪上下文（`Effect`/`Computed` 内部），会为该下标物化一个响应式 cell 并登记依赖；否则走轻量直读路径，不创建 cell 对象 |
| `set(index, value)` | `(index: number, value: number) => void` | 同步 | 写入合法 int32；值不变时跳过写入和通知 |
| `update(index, updater)` | `(index: number, updater: (current: number) => number) => number` | 同步 | 读-改-写：以 CAS 循环方式应用 `updater`，返回写入后的新值（若 `updater` 返回值与当前值相同则直接返回当前值，不产生写入）；详见 [§4.3](#43-update-无锁读-改-写) |
| `sync(index?)` | `(index?: number) => number` | 同步 | 不传 `index`：扫描全部脏页,返回本轮实际变化的下标个数;传 `index`：只检查该下标,返回 `0`/`1` |
| `watch()` | `() => IDisposer` | 同步 | 起一条覆盖整个数组的 `Atomics.waitAsync` 唤醒回路,监听头部 epoch;重复调用返回同一个停止函数 |
| `snapshot()` | `() => Int32Array` | 同步 | 一次性读出全部下标的当前值,返回一个普通的（非共享）`Int32Array` 拷贝 |
| `prune()` | `() => number` | 同步 | 释放已经没有任何观察者的响应式 cell,返回释放的个数;用于高频访问不同下标场景下避免 cell 无限累积 |
| `dispose()` | `() => void` | 同步 | 停止 `watch()`、断开全部已物化 cell 的响应式连接；幂等 |
| `assertActive()` | `() => void` | 同步 | 已释放则抛 `Error('[store] shared array is disposed')`；供了解内部实现需要时使用，正常业务代码不需要调用 |
| `readCell(index)` | `(index: number) => { value; version }` | 同步 | 一致读某一格的原始 value/version，绕过响应式追踪；库内部与调试场景使用 |
| `writeCell(index, value, expected?)` | `(index, value, expected?) => number \| undefined` | 同步 | 底层写入原语，`set`/`update` 基于它实现 |

`get(index)`/`set(index, value)` 对越界或非整数下标（负数、超出 `length`、非整数、`NaN`）统一抛 `RangeError('[store] shared array index out of range: ' + index)`。

### 4.3 `update()`：无锁读-改-写

```ts
array.update(0, (current) => current + 1);
```

`update()` 的执行顺序是：一致读当前值 → **锁外**调用 `updater(current)` 计算出新值 → 校验新值是否合法 int32 → 以"期望值 = current"发起 CAS 写入 → 若写入时发现值已被别的写者改过（CAS 失败），从头重来，最多重试到内部自旋上限（见 [§4](#4-seqlock并发读写的正确性保证)），超限抛 `Error('[store] shared array update at ' + index + ' kept losing the race; another writer never settled')`。

**`updater` 回调必须是纯函数、可安全重复调用**——它在锁外执行、并发冲突会重跑,不要在里面产生不可逆副作用（发网络请求、写非幂等的日志计数等）。若 `updater` 内部抛错，`update()` 会原样把错误抛给调用方，且不会留下任何脏锁状态——锁本来就没在回调执行期间被持有。

若新值和当前值相同（比如 `updater` 是幂等的、算出来还是原值），`update()` 直接返回该值，不发起写入、不推进版本号。

---

## 4. Seqlock：并发读写的正确性保证

每个共享整数格在内存里占用两个 `int32` slot：`[value, seq]`。`seq` 同时充当版本号与写锁：

- **偶数** = 空闲，值稳定，`value` 有效
- **奇数** = 有写者正在写，此刻 `value` 可能处于半写状态，不能读

### 4.1 读：一致性校验 + 有限自旋

```
读 before = seq
若 before 是奇数 → 重试
读 value
读 after = seq
若 before === after → 返回 { value, version: before }
否则 → 重试
```

只要 `before === after` 且为偶数，就能保证这次读到的 `value` 和 `version` 出自同一次已完成的写入。自旋次数上限是 **65536（`1 << 16`）次**；超限说明可能有写者在持锁期间异常终止（线程被杀、页面崩溃），此时无限自旋会把当前线程也拖死,所以到限直接抛 `Error`（消息包含 `'did not settle before the contention limit'`），把"共享内存可能已经写坏"暴露出来,而不是静默卡死。

### 4.2 写：占锁 → 写值 → 放锁

```
读 seq；若为奇数 → 重试获取
CAS(seq, seq, seq+1) 成功即获锁,失败重试
（获锁后）比较 expected（若提供）与当前 value；不符则释放锁、返回 undefined
若新值等于当前值 → 释放锁、返回 undefined（不推进版本号）
写入新 value
seq 推进为 seq+2（committed）
```

获锁同样有 65536 次自旋上限,超限抛 `Error`（消息包含 `'lock was not acquired before the contention limit'`）。写入过程中**不会调用任何用户代码**——`update()` 的用户回调在锁外执行,所以持锁期间不存在"回调抛错导致锁卡在奇数"的问题。

这一版设计修复的是更早期"`Atomics.exchange(value)` 然后 `Atomics.add(version)`"两步式实现的缺陷：两步之间没有互斥,并发写者会导致读者看到"新值配旧版本号",从而误判自己没有变化、漏掉一次通知——这类问题在跨线程共享状态里几乎无法用常规手段排查,因为它不报错,只是"有一帧数据没更新"。

### 4.3 值域校验

所有写入路径（`SharedInt32Signal.value = x`、`SharedInt32Array.set()`/`update()`）都会先校验值是合法 `int32`：整数,且落在 `[-2147483648, 2147483647]`。不合法直接抛 `RangeError`，消息形如 `[store] <what> must be an int32, received <value>`。这是刻意的设计选择——`value | 0` 之类的位运算会把 `2**31`、`3.9` 这样的值**静默**折成完全不同的数字，写入方永远不会知道，跨线程共享的另一端读到的是一个从未被写过的数，且两边都不会报错。

---

## 5. 跨线程同步：`sync()` 与 `watch()`

**本地写入永远即时通知本地 `Runtime`**——`.value = x`、`.set()`、`.update()` 内部在写入成功后会立刻调用 `internalsOf(runtime).notify(...)`，这一步和共享内存、跨线程无关。

**跨 `Runtime`（通常也是跨线程）的写入不会自动出现在另一端**，因为另一端的 `Runtime` 完全不知道这块内存被改过,必须主动检测：

- **手动拉取**：调用 `.sync()`（`SharedInt32Signal.sync()`、`SharedInt32Array.sync()` 或 `sync(index)`）。返回值表示是否发生了变化（数组版返回变化的下标数）。适合已经有自己的消息循环、可以定期 pump 的场景，或者不支持 `Atomics.waitAsync` 的环境。
- **自动推送**：调用 `.watch()`。内部对 seq（`SharedInt32Signal`）或 epoch（`SharedInt32Array`）发起 `Atomics.waitAsync` 循环——一旦对应 slot 被写者 `Atomics.notify()` 唤醒，就自动跑一次 `sync()`，然后立刻重新挂起等待下一次唤醒。返回一个停止函数；重复调用 `.watch()` 会返回同一个停止函数，不会叠加多条回路；`.dispose()` 会自动停止它。

`Atomics.wait`（同步版本）不能在主线程使用（会阻塞事件循环），所以 `watch()` 固定走 `waitAsync`。**环境不支持 `Atomics.waitAsync` 时 `watch()` 直接抛错**（`Error('[store] Atomics.waitAsync is unavailable; pump sync() from your own message loop instead')`），而不是静默退化成轮询——静默降级会让调用方误以为自己确实拿到了推送能力。

停止 `watch()`（无论是手动调用停止函数还是 `dispose()`）会顺带 `Atomics.notify()` 一次，让挂起中的 `waitAsync` Promise 尽快 settle、释放对共享内存视图的引用，而不是一直等到"下一次真正的远端写入"才释放。

---

## 6. 脏页 bitmap：`SharedInt32Array` 的稀疏同步

`SharedInt32Array` 的共享内存布局是：`[epoch, ...bitmap words, value0, seq0, value1, seq1, ...]`。

- **epoch**：每次任意下标完成一次落盘写入，写者都会把 epoch 原子 `+1`。`sync()` 不传 `index` 时,第一步就是比较本地记录的 epoch 和共享内存里的当前 epoch——完全没变就直接返回 `0`，连 bitmap 都不用碰。这一步是为了让**一条** `watch()` 唤醒回路就能覆盖整个数组，不需要给上万个下标各起一个 waiter。
- **脏页 bitmap**：数组按每 32 个格子划为一"页"，每次写入用 `Atomics.or` 点亮自己所在页的 bit（`Atomics.or` 是无损操作,多个写者并发点同一个 bit 不会互相覆盖或丢失标记）。`sync()` 发现 epoch 变化后，用 `Atomics.exchange` 逐 word 读出 bitmap 并清零（`exchange` 是单次原子读改写,不存在"清零期间丢失一次并发 `or`"的时间窗口：并发的 `or` 要么完整发生在 `exchange` 之前，已经反映在读出的旧值里；要么完整发生在之后，作用在刚清零的 0 上，正确地留给下一轮 `sync()` 发现）。
- **逐格确认**：命中的每一页仍然要逐格读 seqlock 版本号,和本地记录比较,真正变了才会通知该下标的观察者。也就是说 **bitmap/epoch 只是"可能变了"的提示，不是正确性来源**——即便某个 bit 因为极端时序被提前清零、写入方的 `or` 恰好卡在那之前完成，页内逐格版本比较仍会在下一轮 `sync()` 里补上这次变化，不会真正漏掉。

效果：百万格的数组里只改动几个分散的下标，`sync()` 的开销只和"变化的页数"相关，而不是和数组长度 `length` 相关——这是从早期"每次 `sync()` 都要过一遍全部 `length` 个 seqlock"的实现改进而来的。一次 `sync()` 扫描到的多个变化会被包在同一个 `runtime.batch()` 里，避免下游因为一次同步里的多处变化而被唤醒多轮。

---

## 7. 响应式集成细节

- **两者都是 `IObservable`**：内部通过 `@migaia/reactive` 的 `internalsOf`/`registerSubs`/`registerVersion`/`claimOwnership` 接入所属 `Runtime` 的依赖图,行为和普通的 `Signal`/`Computed` 节点一致——可以被 `Effect`/`Computed` 追踪,`isStale()` 可查询是否有未同步的远端变化。
- **单一归属**：构造时调用 `claimOwnership(this, runtime)` 登记归属;同一个 JS 对象不能被登记到第二个 `Runtime`（会抛 `Error('this node is already owned by another Runtime')`,来自 `@migaia/reactive` 的所有权系统）。**这意味着共享的是 `SharedArrayBuffer`,而不是 JS 对象本身**——另一个线程/`Runtime` 要读同一份数据,必须用同一个 `buffer` 单独 `new` 一份自己的实例。
- **`SharedInt32Array` 的按需物化**：`get(index)` 只有在检测到当前处于依赖追踪上下文（`internalsOf(runtime).tracker.isTracking()` 为真,即身处 `Effect`/`Computed` 内部）时才会为该下标创建一个 `SharedInt32ArrayCell` 并登记依赖；在追踪上下文之外调用 `get()`（比如普通同步代码里的一次性读取）走直读路径,不产生任何 cell 对象,即使数组有百万个元素,一次性读取的开销也是 `O(1)`。
- **cell 的自动回收**：`Effect`/`Computed` 可能在提交观察之前就放弃一次"投机读"（比如 `Computed` 重新计算时依赖发生了变化）。为此新物化的 cell 会在下一个微任务里检查是否仍有订阅者,没有就自动断开并从内部 Map 里移除,不需要手动处理。
- **手动 `prune()`**：如果访问模式是"高频轮换读取不同下标"（比如遍历式的探测),自动回收的微任务粒度可能不够及时,可以定期调用 `array.prune()` 主动清理当前没有任何订阅者的 cell,返回本次清理掉的个数。

---

## 8. 错误一览表

| 错误消息（关键片段） | 触发条件 | 抛出方式 |
| --- | --- | --- |
| `shared signal buffer is too small` | 传入的 `buffer` 小于 `SharedInt32Signal` 所需的 8 字节 | `RangeError`，构造时 |
| `shared array buffer is too small` | 传入的 `buffer` 小于 `SharedInt32Array` 按 `length` 推算出的所需大小 | `RangeError`，构造时 |
| `shared array length must be a non-negative integer` | `length` 不是非负整数 | `RangeError`，构造时 |
| `shared array index out of range: <n>` | `get`/`set`/`update` 的下标越界或非整数 | `RangeError`，调用时 |
| `<what> must be an int32, received <value>` | 写入的值不是合法 int32（非整数或超出范围） | `RangeError`，写入时 |
| `shared cell did not settle before the contention limit; a writer may still be active or may have abandoned the seqlock` | 一致读自旋 65536 次仍未拿到稳定值 | `Error`，读取时 |
| `shared cell lock was not acquired before the contention limit; another writer may still be active or may have abandoned it` | 获取写锁自旋 65536 次仍未成功 | `Error`，写入时 |
| `shared array update at <n> kept losing the race; another writer never settled` | `update()` 的 CAS 重试自旋 65536 次仍未成功写入 | `Error`，`update()` 调用时 |
| `shared signal is disposed` | 在 `dispose()` 之后访问 `SharedInt32Signal` 的任意成员 | `Error`，调用时 |
| `shared array is disposed` | 在 `dispose()` 之后访问 `SharedInt32Array` 的任意成员 | `Error`，调用时 |
| `Atomics.waitAsync is unavailable; pump sync() from your own message loop instead` | 当前运行环境不支持 `Atomics.waitAsync`，却调用了 `.watch()` | `Error`，`watch()` 调用时 |

以上前几类"自旋超限"错误几乎总是意味着**另一个持锁的写者异常终止**（线程被强制终止、页面崩溃）而没有走到释放锁那一步——共享内存里的 seq 会永远停在奇数。这类错误没有应用层可以自动恢复的办法，通常需要重新创建一块 buffer 并放弃旧的那份共享状态。

---

## 9. 生产环境完整示例

主线程创建共享数组，交给 Worker 处理，双方都能响应式地观察对方的写入：

```ts
// main.ts
import { createRuntime, Effect } from '@migaia/reactive';
import { sharedInt32Array } from '@migaia/store-shared';

const runtime = createRuntime();
const positions = sharedInt32Array(runtime, 1000); // 500 个实体的 x/y 坐标

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ buffer: positions.buffer });

const stopWatch = positions.watch(); // worker 的写入自动推送进来

const render = new Effect(() => {
  const x = positions.get(0);
  const y = positions.get(1);
  drawEntity(0, x, y);
}, runtime);

// 页面卸载时统一清理
window.addEventListener('beforeunload', () => {
  render.dispose();
  stopWatch();
  positions.dispose();
  worker.terminate();
});
```

```ts
// worker.ts
import { createRuntime } from '@migaia/reactive';
import { sharedInt32Array } from '@migaia/store-shared';

self.onmessage = (event: MessageEvent<{ buffer: SharedArrayBuffer }>) => {
  const runtime = createRuntime();
  const positions = sharedInt32Array(runtime, 1000, { buffer: event.data.buffer });

  setInterval(() => {
    positions.update(0, (x) => x + 1); // 每帧推进实体 0 的 x 坐标
  }, 16);
};
```

不支持 `Atomics.waitAsync` 的环境（改用手动 `sync()` 轮询）：

```ts
const positions = sharedInt32Array(runtime, 1000, { buffer: sharedBuffer });

setInterval(() => {
  const changed = positions.sync(); // 返回本轮实际变化的下标个数
  if (changed > 0) console.log(`${changed} 个下标发生了远端变化`);
}, 100);
```

---

## 10. 常见问题排查

**Q：另一个线程明明写了值，我这边读到的还是旧的。**
检查是否调用过 `.watch()` 或定期 `.sync()`——跨 `Runtime` 的写入不会自动出现，本地只有主动拉取或订阅了唤醒回路才能看到远端变化。`.peek()` 也不会主动拉取远端更新，只有 `.value`/`.get()`（在追踪上下文中）或显式 `.sync()` 会。

**Q：`watch()` 抛出 `Atomics.waitAsync is unavailable`。**
当前运行环境不支持该 API（常见于旧版本或某些沙箱环境）。改用定时调用 `.sync()`/`.sync(index)` 轮询，见 [§9](#9-生产环境完整示例) 最后一个例子。

**Q：写入抛 `must be an int32`。**
说明写入的值不是整数，或超出了 `[-2147483648, 2147483647]` 范围——这个包只支持定长 int32 布局，不支持浮点数或更大的整数，需要更大范围可以考虑拆成多个格子自行编码。

**Q：读写偶尔抛 `did not settle before the contention limit` 或 `kept losing the race`。**
通常意味着另一个写者持锁期间异常终止（线程被杀、崩溃），共享内存的锁位永远停在了"正在写"状态。这种情况无法在应用层自动恢复，需要放弃这块 `buffer`，重新创建一份共享状态。

**Q：`SharedInt32Array` 里成千上万个下标，`sync()` 会不会很慢？**
不会。`sync()` 先比较头部 epoch，完全没变直接返回；有变化时只扫描被脏页 bitmap 标记过的页，不是整个数组，见 [§6](#6-脏页-bitmapsharedint32array-的稀疏同步)。

**Q：能不能把 `SharedInt32Signal` 对象直接 `postMessage` 给 Worker？**
不能，且没有必要——`postMessage` 会尝试结构化克隆这个对象，其内部状态无法被克隆出等价实例。应该传 `.buffer`（真正的 `SharedArrayBuffer`，可以被 `postMessage` 直接传递而不拷贝），另一端用同一个 `buffer` 调用 `sharedInt32`/`sharedInt32Array` 各自创建一份实例。

**Q：能不能用这个包存对象、字符串这些复杂数据？**
不能。它只支持定长的 `int32` 布局，这是刻意的设计边界——`SharedArrayBuffer` 本身就是定长的原始内存，塞对象图需要自己实现序列化协议，超出了这个包的职责范围。

## 11. 构建、格式化与测试

在仓库根目录运行：

```bash
pnpm --filter @migaia/store-shared fmt
pnpm --filter @migaia/store-shared lint
pnpm --filter @migaia/store-shared typecheck
pnpm --filter @migaia/store-shared typecheck:test
pnpm --filter @migaia/store-shared test
pnpm --filter @migaia/store-shared build
```

测试覆盖 seqlock 一致读、跨 Runtime 同步、`watch()` 生命周期、数组稀疏同步与错误码。
