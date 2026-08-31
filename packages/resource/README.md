# @migaia/resource

**响应式的可取消异步资源**——把"发一个异步请求"这件事做成一个会随依赖变化自动重新拉取、可取消、有缓存过期、能重试的状态机，你不用为每一个异步数据自己攒一套 loading/error/cancel 变量。

## 1. 这是什么

组件/模块里经常需要这样一段逻辑：根据某个响应式的输入（用户 ID、筛选条件……）发请求，拿到数据前展示 loading，失败要能重试，输入变了要能取消旧请求发新请求，页面离开要能中止在途请求防止内存泄漏和竞态覆盖。这段逻辑本身不难写，难的是每个异步数据点都重写一遍还都要写对——尤其是"旧请求比新请求晚返回，结果把新数据覆盖回旧数据"这类竞态问题。

`Resource<T>` 把这套状态机做成一个可复用的类：构造时给它一个 `fetcher` 函数，它会跟踪 `fetcher` 在**首次 `await` 之前**同步读取的响应式值（Signal/Computed）作为依赖；依赖变化时自动发起新请求，并保证只有最新一代请求的结果才会生效——旧请求哪怕后完成也不会覆盖新状态。它基于 `@migaia/reactive` 的依赖追踪机制实现，本身不发 HTTP 请求、不绑定 React、不依赖 DOM，`fetcher` 里用什么发请求（`fetch`、数据库客户端、RPC、Worker）完全由你决定。

## 2. 适合什么场景

| 场景                                   | 说明                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 数据依赖响应式输入                     | 用户详情随 `userId` Signal 变化、搜索结果随筛选条件变化——依赖变了自动重新请求，不用手写 effect 去 diff |
| 需要 Suspense 兼容的读取方式           | `read()` 成功返回数据、pending 抛 Promise、失败抛错误，直接对接 React Suspense/Error Boundary          |
| 需要缓存过期与后台刷新                 | `ttl` 控制数据新鲜时长，`staleWhileRevalidate` 让刷新时继续展示旧数据                                  |
| 需要失败重试                           | `retry`/`retryDelay` 支持固定次数或自定义判断/退避策略                                                 |
| 需要 SSR/持久化快照恢复                | `dehydrate()`/`hydrate()`/`initialSnapshot` 把成功值序列化后原样恢复，不用重新请求一次                 |
| 需要在 Worker/RPC 场景复用同一套状态机 | `@migaia/store-worker` 的 `workerComputed()` 就是在 `Resource` 上包了一层 Worker RPC 调用              |

不适合的场景：如果异步数据完全不依赖任何响应式输入、只是一次性拉取且不需要取消/重试/缓存过期（比如页面初始化时拉一次静态配置），直接 `await` 一个 Promise 可能更简单，不需要引入状态机。

## 3. 用了之后能得到什么

- **依赖变化自动重新请求**：`fetcher` 里同步读取的 Signal/Computed 会被登记为依赖，依赖变化会被合并成一次新请求（同一批变化里的多次触发只会重新拉取一次）。
- **旧请求不会覆盖新状态**：每次请求都有自己的世代（generation）标记，只有当前世代的结果才会写回状态；被取代的请求即使后完成也会被丢弃。
- **Suspense 友好的读取原语**：`read()` 按 React Suspense 期望的形状工作（成功返回值、pending 抛 Promise、失败抛错误）；`state` 提供完整状态机快照给非 Suspense 场景直接分支渲染。
- **取消语义分层**：`cancel()` 只中止当前请求且资源仍可复用，`dispose()` 彻底终结资源、清理依赖和订阅。
- **缓存与后台刷新**：`ttl` 控制过期时间，`staleWhileRevalidate: true` 时刷新期间继续展示旧成功值，通过 `refreshing` 区分是否在后台刷新。
- **重试与退避策略可配置**：`retry` 接受固定次数或 `(failureCount, error) => boolean` 判断函数，`retryDelay` 同理支持固定值或按失败次数计算的函数。
- **SSR/持久化快照**：`dehydrate()` 导出 JSON 安全的成功快照，`hydrate()`/`initialSnapshot` 在另一端原样恢复，不需要重新发起请求。

## 4. 五分钟上手

```ts
import { Resource, ResourceStatus } from '@migaia/resource';
import { createRuntime } from '@migaia/reactive';

type IUser = { id: string; name: string };

class UserRequestError extends Error {
  readonly code = 'USER_REQUEST_FAILED';

  constructor(readonly status: number) {
    super(`GET /api/user failed: ${status}`);
  }
}

const runtime = createRuntime();

const user = new Resource<IUser>(
  async ({ signal }) => {
    const response = await fetch('/api/user', { signal });
    if (!response.ok) throw new UserRequestError(response.status);
    return (await response.json()) as IUser;
  },
  runtime
);

switch (user.state.status) {
  case ResourceStatus.idle:
  case ResourceStatus.pending:
    console.log('loading...');
    break;
  case ResourceStatus.success:
    console.log(user.state.data);
    break;
  case ResourceStatus.error:
  case ResourceStatus.cancelled:
    console.error(user.state.error);
    break;
}

try {
  const freshUser = await user.refetch();
  console.log('refetched user', freshUser);
} finally {
  user.dispose();
}
```

构造函数默认 `autoStart: true`，因此 `new Resource(...)` 会立即创建第一代请求，并把状态从 `idle` 推进到 `pending`。上面的 `switch` 读取的是当前快照；如果界面需要随请求结算自动更新，应在 `Effect` 或框架适配层的订阅回调中读取 `user.state`，而不是只执行一次 `switch`。

传给 fetcher 的 `signal` 只属于当前这一代请求。调用 `refetch()` 会强制创建新一代、取消仍在途的上一代，并返回新一代的 Promise；上一代即使忽略 abort 后仍然成功返回，也没有资格覆盖当前状态。把 `signal` 传给 `fetch` 的意义是同时停止底层网络工作、节省资源；Resource 的 generation 检查才是防止旧结果覆盖新状态的最终保证。

`dispose()` 是终止整个 Resource，不等同于取消一次请求：它会取消当前 generation、清除 fetcher 建立的 Signal/Computed 依赖，并释放内部状态订阅。它不会释放外部传入的 `runtime`。重复调用 `dispose()` 是安全的，但释放后再读 `state`、调用 `refetch()` 或其他公开操作都会抛出 `RESOURCE_DISPOSED`；若只是暂时停止当前请求并计划稍后复用该实例，应调用 `cancel()`。

依赖某个响应式输入、自动刷新的写法：

```ts
import { Resource, ResourceStatus } from '@migaia/resource';
import { createRuntime } from '@migaia/reactive';
import { fetchUser } from './user-api.js';

const runtime = createRuntime();
const userId = runtime.signal('1');

const user = new Resource(
  ({ signal }) => {
    const id = userId.value; // 在返回 Promise 前读取：Runtime 建立 userId → user 依赖边
    return fetchUser(id, { signal });
  },
  runtime,
  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }
);

const stopRendering = runtime.effect(() => {
  const state = user.state; // 建立 user.state → 当前渲染任务的依赖边
  if (state.status === ResourceStatus.pending) console.log('loading user');
  if (state.status === ResourceStatus.success) console.log('render', state.data);
  if (state.status === ResourceStatus.error) console.error(state.error);
});

export function selectUser(id: string): void {
  userId.value = id;
}

selectUser('2'); // 标脏 Resource；当前请求被替换，新请求使用 id = '2'

export function disposeUserPanel(): void {
  stopRendering();
  user.dispose();
  userId.dispose();
}
```

这里不是两个互不相关的包碰巧共用一个变量。`Resource` 使用同一个 `runtime` 把自己注册成 Reactive 图里的 observer：fetcher 同步读取 `userId.value` 时，Runtime 记录 `userId → user`；渲染 Effect 读取 `user.state` 时，又记录 `user → rendering effect`。因此完整传播路径是 `userId 写入 → Resource 标脏 → 新请求状态写入 → Effect 重跑`。

`selectUser('2')` 后，Reactive 会把同一批次内对 `userId` 的多次写入合并，再通过 idle/microtask 通道通知 Resource。Resource 创建新的 request generation，并 abort 被取代 generation 的 `signal`；`fetchUser('2', ...)` 的 pending/success/error 状态写入内部 Signal，观察 `user.state` 的 Effect 随之重跑。即使旧请求不支持 AbortSignal 并在稍后返回，generation 校验也会丢弃旧结果。

依赖收集只覆盖 fetcher 返回 Promise 之前的同步阶段。上例先把 `userId.value` 读进 `id`，再调用异步 API；如果等到 `await` 之后才读取 `userId.value`，JavaScript 的同步追踪上下文已经结束，这次读取不会建立自动刷新关系。`disposeUserPanel()` 则按消费方向反向释放：先停止渲染 Effect，再终止 Resource，最后释放输入 Signal。

## 5. 核心概念一览

| 概念                   | 是什么                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **State（状态机）**    | `idle` / `pending` / `success`(`data`, 可选 `refreshing`) / `error`(`error`) / `cancelled`(`error: DOMException`) 五态之一，`resource.state` 读取时会顺带触发过期检查 |
| **Fetcher**            | 构造时传入的 `({ signal }) => T \| PromiseLike<T>`；同步读取的响应式值成为依赖，`signal` 应转交给可取消的 I/O                                                         |
| **依赖（deps）**       | fetcher 在**首次 `await` 之前**同步读到的 Signal/Computed；依赖变化会合并触发一次新请求                                                                               |
| **世代（generation）** | 每次请求的身份标记；只有当前世代的结果会写回状态，被取代的请求结果一律丢弃                                                                                            |
| **TTL / 过期**         | 成功值的新鲜时长；过期后下一次读取会触发新请求（除非正在 pending）                                                                                                    |
| **Suspense 读取**      | `read()`：成功返回值、pending 抛 Promise、失败抛错误；`peek()` 是它的非追踪版本                                                                                       |

## 6. 安装与公开入口

```bash
pnpm add @migaia/resource
```

依赖 `@migaia/reactive`（`workspace:^`），需要与其配套版本一起使用。包只公开根入口 `@migaia/resource`：`Resource`、`ResourceStatus`、资源状态/配置/快照类型及 `ResourceErrorCode` 都从此处导入；没有稳定深层子路径。

## 7. 生命周期、错误与边界

1. **依赖追踪只认"首次 `await` 之前的同步读取"**。`await` 之后再读响应式值不会被自动追踪，需要的话应该把这部分读取挪进一个 `Computed` 或在 `await` 之前先读入局部变量。
2. **`fetcher` 必须把 `signal` 交给真正可取消的 I/O**（比如 `fetch(url, { signal })`），否则 `cancel()`/依赖变化引发的取消只是让 `Resource` 忽略这次结果，底层请求仍会跑完。
3. **`refetch()` 总是发起新请求，被动读取（`state`/`promise`/`read()`）只在过期或 idle 时才发起**——想强制刷新用 `refetch()` 或 `invalidate()`，不要指望重复读 `state` 能触发。
4. **不再使用必须 `dispose()`**，否则订阅、在途请求和依赖登记会一直存在；`dispose()` 之后所有方法调用都会抛错。
5. **默认 `keepAlive: false` 时，Resource 长时间无人观察会自动休眠**（清理依赖登记、让缓存过期），下次被观察时会重新发起请求；需要"没人看也保持热数据"就显式传 `keepAlive: true`。

更完整的配置项、每个 API 的精确语义、错误与异常的完整表格、生产级示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
