# @migaia/store-ssr

**给 `@migaia/reactive` 的 Store/Resource 用的请求级 SSR 脱水/复水桥梁**——服务端把一个请求里产生的状态"脱水"成 JSON，塞进 HTML；浏览器里再原样"复水"回去，用户看到的第一屏不用重新请求一次数据。

## 1. 这是什么

服务端渲染最容易出问题的地方不是"怎么把状态转成 JSON"，而是**状态到底属于哪个请求**。如果 Store/Resource 用的是进程级单例，两个并发请求会看到彼此的数据——这是真实存在的 SSR 安全事故,不是理论风险。`store-ssr` 的核心 `SSRRequestScope` 强制每个请求一个隔离的 `Runtime`：只有登记在**这个** `Runtime` 上的 Store/Resource 才能注册进来，登记在别的 `Runtime`（尤其是全局默认 Runtime）上的会被直接拒绝。

围绕这一个类,库提供三件配套的事:

- **脱水/复水**：把请求里注册的 Store（`ISSRStore`）和 Resource（`ISSRResource`）序列化成一份带版本号、深度/节点数有上限的 JSON 快照,客户端拿到快照后调用各自的 `$hydrate`/`hydrate` 复原。
- **异步预取协调**：`awaitResources()` 逐轮等待所有已注册 Resource 的在途请求 settle（包括瀑布式注册出来的新 Resource）,单个失败不拖垮整页,失败清单交给调用方决定怎么处理。
- **安全内联进 HTML**：`serializeSSRState`/`createSSRStateScript` 把 JSON 转成可以安全塞进 `<script>` 标签的文本（转义 `&`/`<`/`>`/行分隔符）,避免脚本注入；`createSSRStateScriptWith` 走 `@migaia/serialize` 的编解码器,支持 JSON 以外的格式。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| Node/Bun/Deno 等服务端渲染 `@migaia/reactive` 驱动的页面 | 每个请求 `createSSRRequestScope()`,渲染完 `dehydrate()`,响应结束后 `dispose()` |
| 页面首屏依赖异步数据(用户信息、配置、列表) | 用 `@migaia/resource` 的 `Resource` 注册进 scope,`dehydrateAsync()` 会先等它们 settle 再打包 |
| 需要把脱水结果安全地内联进 HTML | `createSSRStateScript`/`createSSRStateScriptWith` 处理好了 HTML 转义和脚本注入风险 |
| 需要非 JSON 的传输格式(二进制编解码器) | `createSSRStateScriptWith`/`readSSRStateFromDocumentWith` 接 `@migaia/serialize` 的 `ISerializeRegistry` |

不适合的场景:纯客户端应用(没有服务端渲染这一步)不需要这个包;它也不是通用的"任意对象转 JSON"工具——只服务于实现了 `ISSRStore`/`ISSRResource` 接口的 Store/Resource(`@migaia/store-light` 的 `createStore()`、`@migaia/resource` 的 `Resource` 都天然满足)。

## 3. 用了之后能得到什么

- **请求隔离有强制校验,不是靠约定**:`register()`/`registerResource()` 会比对 `store.$runtime`/`resource.runtime` 与 scope 自己的 `runtime`,不匹配直接抛错,不会把跨请求状态悄悄接错线。
- **脱水结果是 JSON-safe 的,而不是"大概率是"**:深度、节点数、循环引用、非有限数字、非纯对象全部在脱水/校验时兜底,不会把一个格式错误的载荷带到客户端才炸。
- **异步预取容错**:一个 Resource 失败不会让 `dehydrateAsync()` 整体 reject,失败清单可以自定义处理(默认上报到 `Runtime.reportError`)。
- **HTML 内联天然防注入**:`serializeSSRState`/`createSSRStateScript` 转义了会破坏 `<script>` 边界的字符,`createSSRStateScriptWith` 对非 JSON 格式直接走 base64,连转义都不需要。
- **复水时机不挑**:先 `hydrate()` 后 `register()`,或先注册后 hydrate,结果一样——未匹配到已注册 Store/Resource 的快照会先缓存,等对应的 key 注册进来时自动应用。

## 4. 安装

```bash
pnpm add @migaia/store-ssr
```

依赖 `@migaia/reactive`、`@migaia/resource`、`@migaia/serialize`(peer,通常已经在同一个应用里)。这个包本身不读取全局 `document`,`readSSRStateFromDocument`/`readSSRStateFromDocumentWith` 需要显式传入一个满足 `ISSRDocument` 最小接口的对象,浏览器环境下就是 `window.document`。

## 5. 五分钟上手

```ts
// server.ts —— 每个请求都新建一个 scope,渲染完销毁
import { createRuntime } from '@migaia/reactive';
import { createStore } from '@migaia/store-light';
import { createSSRRequestScope, createSSRStateScript } from '@migaia/store-ssr';

function renderPage(): string {
  const scope = createSSRRequestScope(); // 内部自带一个隔离 Runtime
  const app = createStore({ count: 1 }, { runtime: scope.runtime });
  scope.register('app', app);

  const state = scope.dehydrate();
  const html = `<body>${createSSRStateScript(state)}<div id="root"></div></body>`;
  scope.dispose(); // 请求结束,连带释放 owned 的 store
  return html;
}
```

```ts
// client.ts —— 浏览器里读回快照,复水到自己的 Store
import { createStore } from '@migaia/store-light';
import { readSSRStateFromDocument } from '@migaia/store-ssr';

const app = createStore({ count: 1 });
const state = readSSRStateFromDocument(); // 默认读 id="__STORE_STATE__"
if (state) app.$hydrate(state.stores.app);
```

带异步 Resource 预取的写法、多编解码器、错误处理细节见 [USEGUIDE.md](./USEGUIDE.md)。

## 6. 核心概念速览

| 概念 | 是什么 |
| --- | --- |
| **`SSRRequestScope`** | 一个请求一个实例:持有隔离的 `Runtime`,登记本请求的 Store/Resource,提供脱水/复水/等待/销毁 |
| **`ISSRStore` / `ISSRResource`** | Store/Resource 要接入 SSR 必须满足的最小接口(`$runtime`/`$plain`/`$hydrate`/`$dispose` 或 `runtime`/`dehydrate`/`hydrate`/`dispose`) |
| **`ISSRState`** | 脱水结果的形状:`{ version: 1, stores, resources? }`,全部字段都是 JSON-safe 值 |
| **`dehydrate()` vs `dehydrateTrusted()`** | 前者深拷贝+冻结+校验,安全但有开销;后者跳过这些,只用于已知安全、不会被并发修改的数据 |
| **`awaitResources()` / `dehydrateAsync()`** | 前者只等待、返回失败清单;后者在此基础上再脱水,失败默认上报给 `Runtime` |
| **内联脚本** | `createSSRStateScript`(纯 JSON)与 `createSSRStateScriptWith`(走 `@migaia/serialize` 编解码器,支持非 JSON 格式) |

## 7. 模块一览

| 导出 | 一句话 |
| --- | --- |
| `SSRRequestScope` / `createSSRRequestScope()` | 请求作用域本体 |
| `register` / `unregister` / `detach` | 登记、注销(可选连带 dispose)、原样取出 Store |
| `registerResource` / `unregisterResource` / `detachResource` | Resource 版的上面三个 |
| `hydrate(state)` | 把一份 `ISSRState` 应用到已注册/待注册的 Store 与 Resource |
| `dehydrate()` / `dehydrateTrusted()` | 打包当前所有已注册且未销毁的 Store/Resource |
| `awaitResources(options?)` | 等待 Resource 的在途请求 settle,返回失败清单 |
| `dehydrateAsync(options?)` | `awaitResources` + `dehydrate` 的组合 |
| `dispose()` | 结束请求,连带释放 owned 的 Store/Resource |
| `serializeSSRState` / `deserializeSSRState` | `ISSRState` 与 HTML-safe JSON 字符串互转 |
| `createSSRStateScript` / `readSSRStateFromDocument` | 生成/读取纯 JSON 的内联 `<script>` |
| `createSSRStateScriptWith` / `readSSRStateFromDocumentWith` | 走 `ISerializeRegistry` 的编解码器版本 |
| `assertSSRState` | 校验任意值是否为合法 `ISSRState`(不合法抛错) |

## 8. 注意事项(最容易踩的坑)

1. **不要把状态挂在进程级默认 Runtime 上**。`register()`/`registerResource()` 会拒绝 `$runtime`/`runtime` 与 scope 自己的 `runtime` 不一致的对象——这是设计如此,不是 bug,绕过它就等于放弃了请求隔离。
2. **`dehydrateTrusted()` 不是快照**。它返回的是当前的活引用,如果 Store 在你序列化之前又变了,内容会跟着变;拿不准就用 `dehydrate()`。
3. **`dehydrateAsync()` 默认吞掉 Resource 失败**,只是转发给 `Runtime.reportError(error, { phase: 'ssr-resource' })`;想自己处理(比如记日志、给前端一个"部分数据缺失"标记)要传 `onResourceError`。
4. **`hydrate()` 是尽力而为,不是原子操作**。某个 Store 的 `$hydrate()` 抛错不会阻止其余 Store 继续应用,多个失败会合并成 `AggregateError`。
5. **`createSSRStateScript`/`serializeSSRState` 只处理纯 JSON**。要用其他编解码格式(二进制、自定义压缩)必须换成 `*With` 系列,并传入 `@migaia/serialize` 的 registry。
6. **`dispose()` 之后所有方法都会抛错**。scope 是一次性的,一个请求结束就该销毁,不要跨请求复用。
