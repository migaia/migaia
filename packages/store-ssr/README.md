# `@migaia/store-ssr`

给 `@migaia/reactive` 驱动的 Store/Resource 用的请求级 SSR 脱水/复水桥梁：服务端把一次请求里产生的状态"脱水"成 JSON-safe 快照塞进 HTML，浏览器里再原样"复水"回去,首屏不用重新发一次请求。核心 `SSRRequestScope` 强制每个请求一个隔离的 `Runtime`——登记在别的 Runtime（尤其是全局默认 Runtime）上的 Store/Resource 会被直接拒绝,从根上堵住"两个并发请求看到彼此数据"这类 SSR 安全事故。

## 适用与不适用场景

**适用**：Node/Bun/Deno 等服务端渲染 `@migaia/reactive` 驱动的页面,每个请求 `createSSRRequestScope()`,渲染完 `dehydrate()`/`dehydrateAsync()`,响应结束后 `disposeAsync()`；首屏依赖异步数据(用户信息、配置、列表),用 `@migaia/resource` 的 `Resource` 注册进 scope 再 `dehydrateAsync()`；脱水结果需要安全内联进 `<script>` 标签；传输格式需要非 JSON(二进制/自定义压缩)。

**不适用**：纯客户端应用(没有服务端渲染这一步)不需要这个包；它不是通用的"任意对象转 JSON"工具，只服务于实现了 `ISSRStore`/`ISSRResource` 接口的对象(`@migaia/store-light` 的 `createStore()`、`@migaia/resource` 的 `Resource` 天然满足)。

依赖 `@migaia/reactive`、`@migaia/resource`、`@migaia/serialize`、`@migaia/utils`。本包不读取全局 `document`——`readSSRStateFromDocument`/`readSSRStateFromDocumentWith` 需要显式传入满足 `ISSRDocument` 接口的对象。

## 安装

```bash
pnpm add @migaia/store-ssr
```

## 目录

- [`SSRRequestScope`：请求作用域本体](#scope)
- [脱水与复水](#dehydrate)
- [异步预取协调](#async)
- [内联进 HTML：纯 JSON](#html-json)
- [内联进 HTML：多编解码器](#html-codec)
- [校验](#validate)
- [常量](#constants)
- [错误码与错误工厂](#errors)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码表，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="scope"></a>

## `SSRRequestScope`：请求作用域本体

```ts
import { SSRRequestScope, createSSRRequestScope } from '@migaia/store-ssr';
```

**`createSSRRequestScope`｜10 秒上手** —— 每个请求新建一个隔离的 `Runtime`，登记 Store/Resource，渲染完销毁：

```ts
import { createStore } from '@migaia/store-light';

const scope = createSSRRequestScope();
const app = createStore({ count: 1 }, { runtime: scope.runtime });
scope.register('app', app);

const state = scope.dehydrate();
await scope.disposeAsync(); // 请求结束，等待 owned store 的异步 cleanup
```

`ISSRRequestScopeOptions` 全部字段：

- `runtime?: IRuntime` —— 复用一个已存在的、专属本请求的 Runtime；与 `runtimeOptions` 互斥，不提供时内部 `createRuntime()` 新建
- `runtimeOptions?: IRuntimeOptions` —— 转给内部 `createRuntime()` 的选项(`onError`/`onTrace`/`maxFlushPasses`/`scheduleIdle`，定义见 `@migaia/reactive`)；与 `runtime` 互斥

两者同时传入抛 `Error('[store] SSR scope accepts runtime or runtimeOptions, not both')`。`createSSRRequestScope(options)` 等价于 `new SSRRequestScope(options)`。

`scope.runtime`(只读)是这个请求专属的 `IRuntime`，创建挂在这个请求下的 Store/Resource 都要传它。`scope.disposed`(只读)反映是否已 `dispose()`。

**`register`/`unregister`/`detach`｜10 秒上手** —— 登记、注销(可选连带 dispose)、原样取出 Store：

```ts
scope.register('app', app, { owned: true }); // 默认 owned: true
scope.unregister('app'); // 移除并触发 $dispose()
const taken = scope.detach('app'); // 移除但不 dispose，所有权转给调用方
```

- `register(key, store, options?)`：`key: string`(必填，非空且不能是 `'__proto__'`)；`store: ISSRStore`(必填，`$runtime` 必须等于 `scope.runtime`，否则抛错)；`options.owned?: boolean`(默认 `true`)。重复 key 抛错。若该 key 在注册前已通过 `hydrate()` 收到过待处理快照，会先应用到新 Store 上，`$hydrate()` 抛错则注册整体失败、key 保持空闲。
- `unregister(key, disposeOwned?)`：`disposeOwned: boolean`(默认 `true`)；返回该 key 是否存在过。owned 且 `disposeOwned` 为真时启动 `$dispose()`(异步结果由 scope 观察)。
- `detach(key)`：移除登记但不 dispose，返回 `ISSRStore | undefined`。

`registerResource`/`unregisterResource`/`detachResource` 是 Resource 版，签名与语义完全对应，只是校验 `resource.runtime === scope.runtime`。

---

<a id="dehydrate"></a>

## 脱水与复水

```ts
import { createSSRRequestScope } from '@migaia/store-ssr';
```

**`scope.hydrate(state)`｜10 秒上手** —— 把一份 `ISSRState` 应用到已注册/待注册的 Store 与 Resource：

```ts
scope.hydrate(state); // state: ISSRState
```

无额外选项(单参数)。是**尽力而为**，不是原子操作：`state` 先经 `assertSSRState()` 校验；每个 key 若已注册就调用 `$hydrate`/`hydrate`，未注册则存入待处理表等 `register()` 时自动应用。单条目 `$hydrate`/`hydrate` 抛错不阻止其余条目继续处理——一个失败直接抛出原始 error，多个失败抛出 `AggregateError`。每次调用**整体替换**待处理表，不保留上一次遗留的待处理快照。

**`scope.dehydrate()`｜5 秒上手** —— 打包当前所有已注册且未销毁的 Store/Resource，安全但有拷贝开销：

```ts
const state = scope.dehydrate(); // ISSRState
```

无参数。按 key 字典序遍历：Store 调 `$plain()`，结果经深度校验 + 深拷贝 + 冻结；Resource 调 `dehydrate()`，返回 `undefined` 直接跳过，有值则只对 `snapshot.data` 做同样处理，`version`/`updatedAt`/`expiresAt` 原样保留。整体 `Object.freeze`。

**`scope.dehydrateTrusted()`｜5 秒上手** —— 跳过校验/拷贝的快速路径，**不是快照**：

```ts
const trusted = scope.dehydrateTrusted();
const text = serializeTrustedSSRState(trusted); // 必须紧跟调用，中间不能有其他异步/mutation
```

无参数。返回值里每个值都是 `$plain()`/`dehydrate()` 当场返回的活引用，不拷贝、不深度冻结、不做 JSON 校验——Store 在调用后、序列化前若发生变化，载荷会跟着变。只在"每个值都已知安全、调用期间不会被并发修改"时使用(如库自带固定文档)，绝不应用于请求输入或可能并发变化的 Store。返回类型带不可外部构造的品牌，`serializeTrustedSSRState()` 只接受这个品牌类型。

---

<a id="async"></a>

## 异步预取协调

```ts
import { createSSRRequestScope } from '@migaia/store-ssr';
```

**`scope.awaitResources(options?)`｜10 秒上手** —— 逐轮等待所有已注册 Resource 的在途请求 settle，返回失败清单：

```ts
const failures = await scope.awaitResources({ timeoutMs: 3000 });
```

`IAwaitResourcesOptions` 全部字段：

- `timeoutMs?: number` —— 整个等待过程的总预算(不是单个 Resource 各自的超时)；不设置则一直等到全部 settle；`0` 合法，语义是"立刻过期"；非法值(非有限数字或负数)同步抛 `RangeError`

逐轮 settle，按 **Promise 身份**去重(不按 key)——同一 key 的 retry/refetch 拿到新 Promise 仍会被继续等到。三种失败旁路都收进 `failures`，不中止整个等待：`.promise` getter 同步抛错(同 key 只记一次)、单个 Resource 超时(`'[store] SSR resource "${key}" did not settle within ${timeoutMs}ms'`)、等待期间 `scope.dispose()` 被调用(直接返回已收集结果)。轮次上限 64，超过抛 `Error('[store] SSR resources kept registering new resources past 64 rounds')`(应对瀑布式无限注册)。

**`scope.dehydrateAsync(options?)`｜10 秒上手** —— `awaitResources` + `dehydrate` 的组合：

```ts
const state = await scope.dehydrateAsync({
  timeoutMs: 3000,
  onResourceError: (failure) => log.warn('resource failed', failure)
});
```

`IDehydrateAsyncOptions` 全部字段：

- `timeoutMs?: number` —— 透传给内部 `awaitResources`
- `onResourceError?: (failure: ISSRResourceFailure) => void` —— 提供后**替代**默认行为(默认转发给 `scope.runtime.reportError(failure.error, { phase: 'ssr-resource' })`)

失败的 Resource 不会出现在返回的 `state.resources` 里，其余成功的 Resource 和全部 Store 照常打包，不会因一个 Resource 失败拖垮整页。

---

<a id="html-json"></a>

## 内联进 HTML：纯 JSON

```ts
import {
  serializeSSRState,
  deserializeSSRState,
  createSSRStateScript,
  readSSRStateFromDocument
} from '@migaia/store-ssr';
```

**`serializeSSRState`｜3 秒上手** —— 校验 + `JSON.stringify` + HTML 转义，不做 `<script>` 包装：

```ts
const text = serializeSSRState(state); // state: ISSRState
```

单参数，无选项。转义 `&`/`<`/`>`/U+2028/U+2029(单次正则扫描)，防止载荷里的 `</script>` 提前闭合标签。

**`deserializeSSRState`｜3 秒上手**（单参数，无选项）：

```ts
const state = deserializeSSRState(text); // JSON.parse + assertSSRState，格式不对直接抛错
```

**`createSSRStateScript`｜5 秒上手** —— 生成完整的 `<script type="application/json">` 标签：

```ts
const html = createSSRStateScript(state); // 默认 elementId = '__STORE_STATE__'
```

第二参数 `elementId?: string`(默认 `'__STORE_STATE__'`)——必须匹配 `/^[A-Za-z_][A-Za-z0-9_:.-]*$/`，不匹配抛 `Error('[store] invalid SSR state script id')`。

**`readSSRStateFromDocument`｜5 秒上手** —— 从注入的文档对象读回并反序列化：

```ts
const state = readSSRStateFromDocument(); // 默认同一个 elementId，浏览器端传 window.document
```

全部参数：`elementId?: string`(默认 `'__STORE_STATE__'`)、`document?: ISSRDocument`(不传视为找不到元素)。元素不存在或 `textContent` 为空返回 `undefined`。`ISSRDocument` 只要求 `getElementById(id)` 返回 `{ textContent, getAttribute(name) } | null`。

---

<a id="html-codec"></a>

## 内联进 HTML：多编解码器

```ts
import { createSSRStateScriptWith, readSSRStateFromDocumentWith } from '@migaia/store-ssr';
import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize';
```

**`createSSRStateScriptWith`｜10 秒上手** —— 走 `@migaia/serialize` 编解码器，支持非 JSON 格式：

```ts
const codecs = createSerializeRegistry([jsonPlugin()]);
const html = await createSSRStateScriptWith(state, { codecs });
```

`ISSRScriptOptions` 全部字段：

- `codecs: ISerializeRegistry`（必填）—— 实际写入格式取决于 `codecs.primaryType`(注册表第一个插件)
- `elementId?: string`（默认 `'__STORE_STATE__'`，与纯 JSON 版本共用同一条校验正则）
- `signal?: AbortSignal`（透传给 `codecs.encode`）

`codecs.encode()` 产出 `['value', ...]` 会抛 `TypeError`(SSR 载荷必须是线上数据)。`type === 'json'` 且产出 `['text', ...]` 时走 HTML 转义，标签属性 `data-codec="json" data-wire="text"`；其余情况一律 base64 编码，`data-wire="b64"`，`type="text/plain"`(非 `application/json`，避免浏览器把非 JSON 载荷当可执行内容)。`elementId` 额外经属性转义(`&`/`"`/`'`/`<`/`>`)后写入 `id="..."`。

**`readSSRStateFromDocumentWith`｜10 秒上手**：

```ts
const state = await readSSRStateFromDocumentWith({ codecs, document });
```

`ISSRReadOptions` 全部字段：

- `codecs: ISerializeRegistry`（必填）
- `elementId?: string`（默认 `'__STORE_STATE__'`）
- `document?: ISSRDocument`（不传视为找不到元素，返回 `undefined`）
- `signal?: AbortSignal`（透传给 `codecs.decode`）

优先读 `data-codec`(缺省 `'json'`)和 `data-wire`(缺省 `'text'`)属性决定解码方式；`data-codec` 标注的类型未注册进 `codecs` 时抛 `Error('[store] SSR payload was written by codec "${type}", which is not registered')`。解码结果最终仍过一遍 `assertSSRState`。

---

<a id="validate"></a>

## 校验

```ts
import { assertSSRState } from '@migaia/store-ssr';
```

**`assertSSRState`｜5 秒上手** —— 校验任意值是否为合法 `ISSRState`，是 `deserializeSSRState`/`hydrate()`/`readSSRStateFromDocumentWith` 共用的校验函数：

```ts
assertSSRState(value); // 通过则收窄类型为 ISSRState，不通过则抛错
```

单参数，无选项。规则：必须是纯对象且 `version === 1`；`stores` 必须是纯对象，每个 key 非空且不能是 `'__proto__'`，每个 value 必须是合法 JSON 对象；`resources`(可选)必须是纯对象，每个 value 必须是纯对象、`version === 1`、`updatedAt` 是有限数字、`expiresAt` 是 `null` 或有限数字，`data` 字段再走一遍 JSON 合法性校验(拒绝非纯对象/非有限数字/循环引用/深度超 256/节点数超 1,000,000)。

---

<a id="constants"></a>

## 常量

```ts
import { SsrWorkOutcome, SsrWireType } from '@migaia/store-ssr';
```

**`SsrWorkOutcome`｜3 秒上手** —— `awaitResources()` 内部三方竞速的结果标签，一般不需要在业务代码里直接使用：

```ts
SsrWorkOutcome.value; // 'value'
SsrWorkOutcome.disposed; // 'disposed'
SsrWorkOutcome.timeout; // 'timeout'
```

无调用参数，是一个 `as const` 常量对象；`ISsrWorkOutcome` 是其取值的联合类型。

**`SsrWireType`｜3 秒上手** —— `createSSRStateScriptWith`/`readSSRStateFromDocumentWith` 用到的线上编码标签：

```ts
SsrWireType.json; // 'json'
SsrWireType.text; // 'text'
SsrWireType.bytes; // 'bytes'
```

无调用参数，常量对象；`ISsrWireType` 是其取值的联合类型。

---

<a id="errors"></a>

## 错误码与错误工厂

```ts
import {
  StoreSsrErrorCode,
  createStoreSsrError,
  createStoreSsrRangeError,
  createStoreSsrTypeError,
  createStoreSsrAggregateError
} from '@migaia/store-ssr';
```

**`StoreSsrErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较，配合 `attachErrorIdentity` 贴出来的 `code` 字段使用：

```ts
if (error.code === StoreSsrErrorCode.crossRuntime) {
  /* ... */
}
```

全部取值：`scopeDisposed`(`SCOPE_DISPOSED`)、`scopeDisposalFailed`(`SCOPE_DISPOSAL_FAILED`)、`hydrateFailed`(`HYDRATE_FAILED`)、`invalidSnapshot`(`INVALID_SNAPSHOT`)、`invalidStateScript`(`INVALID_STATE_SCRIPT`)、`invalidStoreKey`(`INVALID_STORE_KEY`)、`serializeUnsupported`(`SERIALIZE_UNSUPPORTED`)、`invalidOption`(`INVALID_OPTION`)、`crossRuntime`(`CROSS_RUNTIME`)、`codecContract`(`CODEC_CONTRACT`)、`resourceRoundLimit`(`RESOURCE_ROUND_LIMIT`)、`resourceTimeout`(`RESOURCE_TIMEOUT`)。

**`createStoreSsrError`/`createStoreSsrRangeError`/`createStoreSsrTypeError`｜5 秒上手** —— 本包内部用来构造带 `(source, code)` 身份的错误，导出后也可供上层代码复用同一套错误身份约定：

```ts
throw createStoreSsrError(StoreSsrErrorCode.invalidOption, '自定义消息');
throw createStoreSsrRangeError(StoreSsrErrorCode.invalidOption, '自定义消息');
throw createStoreSsrTypeError(StoreSsrErrorCode.invalidOption, '自定义消息');
```

三者签名一致：`(code: IStoreSsrErrorCode, message: string, options?: { readonly cause?: unknown })`，分别产出 `Error`/`RangeError`/`TypeError`(`createStoreSsrTypeError` 不接受第三个 `options` 参数)，内部经 `@migaia/utils/error` 的 `attachErrorIdentity` 贴上 `source: '@migaia/store-ssr'` 与传入的 `code`。

**`createStoreSsrAggregateError`｜5 秒上手**：

```ts
throw createStoreSsrAggregateError(StoreSsrErrorCode.hydrateFailed, [err1, err2], '批量失败');
```

签名：`(code: IStoreSsrErrorCode, errors: unknown[], message: string)`，产出贴好身份的 `AggregateError`，`errors[]` 保持可达。

`STORE_SSR_SOURCE`(`'@migaia/store-ssr'`)是贴在每个本包错误上的固定 `source` 值，一般不需要手动引用，除非要用它去过滤/识别本包抛出的错误。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 带异步 Resource 预取的完整请求处理流程

```ts
import { createStore } from '@migaia/store-light';
import { Resource } from '@migaia/resource';
import { createSSRRequestScope, createSSRStateScript } from '@migaia/store-ssr';

export async function renderPage(userId: string): Promise<string> {
  const scope = createSSRRequestScope();
  try {
    const app = createStore({ theme: 'dark' }, { runtime: scope.runtime });
    scope.register('app', app);

    const user = new Resource(
      async ({ signal }) => {
        const response = await fetch(`/api/users/${userId}`, { signal });
        if (!response.ok) throw new Error('加载用户失败');
        return response.json();
      },
      scope.runtime,
      { ttl: 30_000 }
    );
    scope.registerResource('user', user);

    const state = await scope.dehydrateAsync({
      timeoutMs: 3000,
      onResourceError: (failure) =>
        console.warn(`[ssr] resource "${failure.key}" failed`, failure.error)
    });

    return `<!doctype html><html><body>${createSSRStateScript(state)}<div id="root"></div></body></html>`;
  } finally {
    scope.dispose();
  }
}
```

### 2. 客户端复水

```ts
import { createRuntime } from '@migaia/reactive';
import { createStore } from '@migaia/store-light';
import { Resource } from '@migaia/resource';
import { readSSRStateFromDocument } from '@migaia/store-ssr';

const runtime = createRuntime();
const app = createStore({ theme: 'dark' }, { runtime });
const user = new Resource(fetchUser, runtime, { ttl: 30_000, autoStart: false });

const state = readSSRStateFromDocument();
if (state) {
  if (state.stores.app) app.$hydrate(state.stores.app);
  if (state.resources?.user) user.hydrate(state.resources.user);
}
```

### 3. 非 JSON 编解码器 + 属性转义内联

```ts
import { createSerializeRegistry } from '@migaia/serialize';
import { createSSRStateScriptWith, readSSRStateFromDocumentWith } from '@migaia/store-ssr';
import { binaryPlugin } from './binary-plugin.js';

const codecs = createSerializeRegistry([binaryPlugin()]);
const html = await createSSRStateScriptWith(state, { codecs, elementId: 'app-state' });

// 浏览器端，读取时必须用同一份 codecs 配置
const restored = await readSSRStateFromDocumentWith({ codecs, elementId: 'app-state', document });
```

### 4. 用错误码分支处理 hydrate 失败

```ts
import { StoreSsrErrorCode } from '@migaia/store-ssr';

try {
  scope.hydrate(state);
} catch (error) {
  if ((error as { code?: string }).code === StoreSsrErrorCode.hydrateFailed) {
    console.warn('部分 store/resource 复水失败，其余已应用', error);
  } else {
    throw error;
  }
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm --filter @migaia/store-ssr fmt
pnpm --filter @migaia/store-ssr lint
pnpm --filter @migaia/store-ssr typecheck
pnpm --filter @migaia/store-ssr typecheck:test
pnpm --filter @migaia/store-ssr test
pnpm --filter @migaia/store-ssr build
```
