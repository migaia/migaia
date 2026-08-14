# @migaia/store-shared

**基于 `SharedArrayBuffer` + `Atomics` 的跨线程响应式整数状态**——把一块共享内存包装成 `@migaia/reactive` 认识的 `IObservable`，让 Worker、主线程、多个 `Runtime` 之间可以用同一套读写协议共享数据，而不必靠 `postMessage` 传结构化克隆。

## 1. 这是什么

两个线程要共享状态，通常只有两条路：要么靠 `postMessage` 来回传消息（每次都要序列化/反序列化，还要自己维护"谁的版本新"），要么用 `SharedArrayBuffer` 直接共享同一块内存（快，但要自己处理并发读写——两个线程同时写同一格,会不会读到"值已经变了、版本号却没变"这种半吊子状态？谁都不知道)。

`@migaia/store-shared` 解决的是第二条路上的并发正确性问题。它在共享内存上实现了一个 **seqlock（序列锁）**：每个整数格配一个版本号，写入时先占锁（版本号变奇数）、写完再放锁（版本号 +2 变偶数）；读的时候比较锁前锁后的版本号，不一致就重读。这样可以保证"读到的值"和"读到的版本号"永远来自同一次完成的写入，不会出现值新了但版本号显示没变、导致另一个线程漏掉这次更新的情况。

在这层保证之上，`store-shared` 把共享格包装成 `@migaia/reactive` 的一等公民：`Effect`/`Computed` 里读取 `signal.value` 或 `array.get(i)` 会被自动追踪，本地写入会自动触发通知——用法和普通的响应式状态没有区别，只是这块状态背后是一段可以被另一个线程同时读写的内存。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 主线程 ↔ Worker 共享少量数值状态 | 比如渲染循环里的坐标、计数器、状态标志位，不想每帧都 `postMessage` |
| 多个 `Runtime` 观察同一份数据 | 同页面内多个独立的响应式图，通过共享 buffer 而不是共享对象引用同步 |
| 需要低延迟、无拷贝的跨线程通知 | `Atomics.waitAsync` 让远端写入直接推送过来，不需要轮询 |
| 大数组里只有少数下标频繁变化 | `SharedInt32Array` 按脏页扫描，改一格不会导致整个数组被扫一遍 |

不适合的场景：

- **不是通用状态管理方案**。它只支持固定布局的 `int32` 数值（单个格或定长数组），不能存字符串、对象、嵌套结构——真要跨线程传对象图，用 `structuredClone`/`postMessage` 或专门的序列化协议。
- 如果两端本来就在同一个线程里，用普通的 `@migaia/reactive` `Signal` 就够了，不需要 `SharedArrayBuffer` 这层复杂度。
- 跨线程但只是"偶尔通知一下"、数据量小、延迟不敏感，`postMessage` 往往更简单，不必上共享内存。

## 3. 用了之后能得到什么

- **值与版本号永不脱节**：seqlock 保证读到的 value 和 version 一定来自同一次完成的写入，不会出现"新值配旧版本号"从而漏掉一次通知的情况。
- **响应式集成免费拿到**：`SharedInt32Signal`/`SharedInt32Array` 都是 `IObservable`，在 `Effect`/`Computed` 里读取会被自动追踪，写入会自动触发本地通知,不需要额外接线。
- **远端写入可以推送，不必轮询**：`.watch()` 起一条基于 `Atomics.waitAsync` 的唤醒回路，另一个线程的写入会自动同步进本地 `Runtime`；不支持 `waitAsync` 的环境也可以自己在消息循环里定期调 `.sync()`。
- **大数组稀疏更新不掉性能**：`SharedInt32Array` 用脏页 bitmap 记录"哪些页可能变了",`sync()` 只扫这些页，不是整个数组——百万格数组改几格,同步开销和数组长度无关。
- **拒绝静默数据损坏**：写入值超出 `int32` 范围、buffer 太小、下标越界都会直接抛错,不会像 `value | 0` 那样把 `2**31` 悄悄折成一个你从未写过的数字。
- **单实例只属于一个 `Runtime`**：同一个 `SharedInt32Signal`/`SharedInt32Array` 对象不能跨 `Runtime` 复用（会抛错）,想让另一个 `Runtime`/线程共享同一份数据,要传同一个 `buffer` 各自创建一个实例。

## 4. 五分钟上手

```ts
import { createRuntime, Effect } from '@migaia/reactive';
import { sharedInt32 } from '@migaia/store-shared';

const runtime = createRuntime();
const counter = sharedInt32(runtime, 0); // 新建一块共享内存,初始值 0

const stop = new Effect(() => {
  console.log('counter =', counter.value); // 读取会被自动追踪
}, runtime);

counter.value = 1; // 本地写入,Effect 自动重跑

stop.dispose();
counter.dispose();
```

跨线程共享同一份数据：把 `counter.buffer`（一个真正的 `SharedArrayBuffer`）传给 `postMessage`，另一端用同一个 buffer 创建实例即可读到同一块内存：

```ts
// 主线程
const shared = sharedInt32(mainRuntime, 0);
worker.postMessage({ buffer: shared.buffer });

// worker 线程
const mirror = sharedInt32(workerRuntime, 0, receivedBuffer); // 附着已有 buffer,initialValue 被忽略
mirror.watch(); // 起唤醒回路,主线程的写入会自动推送过来
```

## 5. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **Seqlock** | 每个整数格配一个版本号（`seq`）：偶数表示空闲,奇数表示有人正在写。读者据此判断自己读到的 value/version 是否同源 |
| **`version`** | 每次完成的写入把 seq 推进 2；用于判断"这份数据自上次观察以来是否变过" |
| **`sync()`** | 主动把远端（另一个线程/`Runtime`）已完成的写入拉取进本地,并触发本地通知 |
| **`watch()`** | 基于 `Atomics.waitAsync` 起一条自动唤醒回路,远端写入直接推送,不必手动轮询 `sync()` |
| **Epoch + 脏页 bitmap**（仅 `SharedInt32Array`） | 数组头部维护一个全局写计数器和按页记录的脏标记,`sync()` 据此只扫描可能变化的页,而不是整个数组 |
| **Ownership（归属）** | 每个共享对象在构造时登记归属某个 `Runtime`,同一个对象不能被登记到第二个 `Runtime` |

## 6. 两个原语一览

| API | 参数类型 | 用途 | 一句话 | 同步/异步 |
| --- | --- | --- | --- | --- |
| `sharedInt32(runtime, initialValue?, buffer?)` → `SharedInt32Signal` | `runtime: IRuntime, initialValue?: number, buffer?: SharedArrayBuffer` | 单个共享 int32 值 | 类似 `@migaia/reactive` 的 `Signal`,但值存在 `SharedArrayBuffer` 里,可跨线程读写 | 同步 |
| `sharedInt32Array(runtime, length, options?)` → `SharedInt32Array` | `runtime: IRuntime, length: number, options?: { buffer?: SharedArrayBuffer; initialValues?: Iterable<number> }` | 定长共享 int32 数组 | 每个下标独立追踪、独立通知,配合脏页 bitmap 做稀疏同步,适合成百上千个格子的场景 | 同步 |

两者完整的构造参数、方法签名、错误类型、内部机制（seqlock 细节、脏页 bitmap 原理、`update()` 的 CAS 重试语义等）见 **[USEGUIDE.md](./USEGUIDE.md)**。

## 7. 安装

```bash
pnpm add @migaia/store-shared
```

依赖 `@migaia/reactive`（同 monorepo 内部依赖，随本包一并安装），使用前需要先有一个 `Runtime`（`createRuntime()`）。

## 8. 注意事项（最容易踩的坑）

1. **只能存 `int32`**。写入非整数、超出 `[-2147483648, 2147483647]` 范围的值会直接抛 `RangeError`,不会静默截断。
2. **附着已有 `buffer` 时,`initialValue`/`initialValues` 会被忽略**——数据已经在那块内存里了,不会被覆盖。
3. **远端写入不会自动通知本地**，除非调用了 `.watch()`。没有 `watch()` 的话,`Runtime` 之间共享同一个 `buffer` 只能靠手动 `.sync()` 拉取,不 `sync()` 就看不到对方的最新值。
4. **`.watch()` 依赖 `Atomics.waitAsync`**，环境不支持（比如较旧的运行时）会直接抛错，而不是静默退化成轮询——需要自己判断环境能力或捕获这个错误后改走手动 `sync()`。
5. **`SharedInt32Array#update()` 的回调必须是纯函数、可重复执行**。回调在锁外运行、失败重试，重试期间会反复调用同一个回调，不要在里面做不可逆副作用（发请求、写日志计数等）。
6. **一个共享对象只能属于一个 `Runtime`**。想让第二个 `Runtime`（比如另一个线程）访问同一份数据，要用同一个 `buffer` 单独创建一份实例，而不是把同一个 `SharedInt32Signal` 对象传过去（对象本身传不过线程边界，`SharedArrayBuffer` 才能）。
7. **`dispose()` 之后所有操作都会抛错**，包括 `.value`、`.get()`、`.sync()`——共享对象一旦释放就不能再用，需要的话重新 attach 到同一个 buffer 创建新实例。

## 9. 深入参考

完整的构造参数表、方法签名、seqlock 与脏页 bitmap 的内部机制、`update()` 的 CAS 重试细节、`watch()`/`sync()` 精确语义、错误一览表、以及贴近生产的跨线程完整示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
