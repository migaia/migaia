# 使用手册

本文是 `@migaia/store-ssr` 的完整参考手册。先看 [README.md](./README.md#5-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来",本文讲"每一个 API、每一个字段、每一种边界行为"。

## 目录

1. [导入与依赖关系](#1-导入与依赖关系)
2. [心智模型:请求隔离怎么保证的](#2-心智模型请求隔离怎么保证的)
3. [SSRRequestScope 构造参考](#3-ssrrequestscope-构造参考)
4. [接入接口:ISSRStore / ISSRResource](#4-接入接口issrstore--issrresource)
5. [注册与生命周期 API](#5-注册与生命周期-api)
6. [hydrate() 完整语义](#6-hydrate-完整语义)
7. [dehydrate() 与 dehydrateTrusted()](#7-dehydrate-与-dehydratetrusted)
8. [awaitResources() 与 dehydrateAsync()](#8-awaitresources-与-dehydrateasync)
9. [dispose() 完整语义](#9-dispose-完整语义)
10. [ISSRState 校验规则与 JSON 安全限制](#10-issrstate-校验规则与-json-安全限制)
11. [内联进 HTML:纯 JSON 版本](#11-内联进-html纯-json-版本)
12. [内联进 HTML:多编解码器版本](#12-内联进-html多编解码器版本)
13. [错误一览表](#13-错误一览表)
14. [生产环境完整示例](#14-生产环境完整示例)
15. [常见问题排查](#15-常见问题排查)

---

## 1. 导入与依赖关系

```ts
import {
  SSRRequestScope,
  createSSRRequestScope,
  serializeSSRState,
  deserializeSSRState,
  createSSRStateScript,
  readSSRStateFromDocument,
  createSSRStateScriptWith,
  readSSRStateFromDocumentWith,
  assertSSRState
} from '@migaia/store-ssr';
import type {
  ISSRState,
  ISSRStore,
  ISSRResource,
  ISSRRequestScopeOptions,
  ISSRRegistrationOptions,
  IDehydrateAsyncOptions,
  IAwaitResourcesOptions,
  ISSRResourceFailure,
  ISSRDocument,
  ISSRScriptOptions,
  ISSRReadOptions,
  ITrustedSSRState
} from '@migaia/store-ssr';
```

这个包只有 `src/ssr.ts` 一个源文件,依赖 `@migaia/reactive`(`createRuntime`、`IRuntime`、`claimOwnership`)、`@migaia/resource`(`IResourceCacheSnapshot`)、`@migaia/serialize`(`ISerializeChunk`、`ISerializeRegistry`、`base64ToBytes`、`bytesToBase64`)。它不 import 任何 DOM 全局对象,也不读取 `globalThis.document`——需要读文档时,`readSSRStateFromDocument`/`readSSRStateFromDocumentWith` 要求显式传入一个满足 `ISSRDocument` 接口的对象。

---

## 2. 心智模型:请求隔离怎么保证的

SSR 场景里最危险的错误是"两个并发请求共享了同一份可变状态"。`store-ssr` 用三条机制堵住这个口子,理解它们是理解整个包的关键:

1. **每个 `SSRRequestScope` 自带一个独立的 `Runtime`**(除非显式传入)。`Runtime` 是 `@migaia/reactive` 里状态归属的最终判据。
2. **`register()`/`registerResource()` 会强制校验归属**:传入的 Store/Resource 必须满足 `store.$runtime === this.runtime`(或 `resource.runtime === this.runtime`),否则直接抛错拒绝注册。这意味着即使不小心把一个挂在全局默认 Runtime、或另一个请求的 Runtime 上的 Store 传进来,也无法注册成功——校验在注册那一刻就拦下,不会等到脱水阶段才发现串数据。
3. **`scope.runtime` 本身也向 `@migaia/reactive` 的所有权表登记**(内部调用 `claimOwnership`),防止同一个 Runtime 被两个 scope 同时声明所有权。

因此正确的用法永远是:**为每个请求调用一次 `createSSRRequestScope()`,用 `scope.runtime` 创建这个请求要用的全部 Store/Resource,请求结束后 `await scope.disposeAsync()`**。只需同步关闭入口时可调用 `scope.dispose()`；真实 Store 的异步 `$dispose()` 仍由 `disposeAsync()` 等待。把 Store 创建在进程级单例 Runtime 上再注册进 scope,是这个库明确设计为要拒绝的用法。

---

## 3. SSRRequestScope 构造参考

```ts
const scope = createSSRRequestScope(); // 最常见:内部新建一个隔离 Runtime

const scopeWithOptions = createSSRRequestScope({
  runtimeOptions: { onError: (error, ctx) => report(error, ctx) }
});

const scopeWithExistingRuntime = createSSRRequestScope({
  runtime: existingIsolatedRuntime // 已经自己创建好的、专属这个请求的 Runtime
});
```

| 构造选项 | 类型 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| `runtime` | `IRuntime` | 可选 | 内部 `createRuntime()` 新建 | 复用一个已存在的、专属本请求的 Runtime。与 `runtimeOptions` 互斥。 |
| `runtimeOptions` | `IRuntimeOptions` | 可选 | `undefined` | 转给内部 `createRuntime()` 的选项(`onError`/`onTrace`/`maxFlushPasses`/`scheduleIdle`,定义见 `@migaia/reactive`)。与 `runtime` 互斥。 |

`runtime` 与 `runtimeOptions` 同时传入会立即抛出 `Error('[store] SSR scope accepts runtime or runtimeOptions, not both')`——构造函数不会尝试猜测哪个优先。`createSSRRequestScope(options)` 是 `new SSRRequestScope(options)` 的函数式包装,两者完全等价。

`scope.runtime`(只读属性)是这个请求专属的 `IRuntime`,创建挂在这个请求下的 Store/Resource 时都要传它。`scope.disposed`(只读属性)反映当前是否已经调用过 `dispose()`。

---

## 4. 接入接口:ISSRStore / ISSRResource

一个 Store 要能被 `register()` 接受,必须实现:

```ts
type ISSRStore = {
  readonly $runtime: IRuntime;
  readonly $disposed: boolean;
  $plain(): Record<string, unknown>;       // 导出可脱水的纯数据快照
  $hydrate(state: Record<string, unknown>): void; // 应用一份快照
  $dispose(): void | PromiseLike<void>;
};
```

`@migaia/store-light` 的 `createStore()` 返回值原生满足这个接口——`$runtime`、`$disposed`、`$plain()`、`$hydrate()`、`$dispose()` 字段名和语义完全对应,不需要任何适配层。

一个 Resource 要能被 `registerResource()` 接受,必须实现:

```ts
type ISSRResource = {
  readonly runtime: IRuntime;
  readonly disposed: boolean;
  readonly promise: Promise<unknown>;               // 当前在途/缓存的请求
  dehydrate(): IResourceCacheSnapshot<unknown> | undefined; // 无成功值时返回 undefined
  hydrate(snapshot: IResourceCacheSnapshot<unknown>): void;
  dispose(): void;
};
```

`@migaia/resource` 的 `Resource<T>` 类原生满足这个接口。两者的字段命名故意不同(`$` 前缀 vs 无前缀)——这不是疏忽,是延续各自包里已有的命名约定,`store-ssr` 只是按各自的真实形状分别定义了两个接口,没有强行统一。

```ts
import { createStore } from '@migaia/store-light';
import { Resource } from '@migaia/resource';

const app = createStore({ count: 0 }, { runtime: scope.runtime }); // 满足 ISSRStore
const user = new Resource(fetchUser, scope.runtime, { ttl: 30_000 }); // 满足 ISSRResource
```

---

## 5. 注册与生命周期 API

| API | 参数 | 返回值 | 同步/异步 | 作用 |
| --- | --- | --- | --- | --- |
| `register(key, store, options?)` | `key: string`；`store: ISSRStore`；`options.owned?: boolean`(默认 `true`) | `void` | 同步 | 登记一个 Store。 |
| `unregister(key, disposeOwned?)` | `key: string`；`disposeOwned: boolean`(默认 `true`) | `boolean`(是否存在过) | 同步 | 移除登记;`disposeOwned` 为真且该注册是 owned 时启动 `$dispose()`；异步结果由 scope 观察。 |
| `detach(key)` | `key: string` | `ISSRStore \| undefined` | 同步 | 移除登记但**不** dispose,所有权转交给调用方。 |
| `registerResource(key, resource, options?)` | 同 `register` | `void` | 同步 | Resource 版的 `register`。 |
| `unregisterResource(key, disposeOwned?)` | 同 `unregister` | `boolean` | 同步 | Resource 版的 `unregister`。 |
| `detachResource(key)` | `key: string` | `ISSRResource \| undefined` | 同步 | Resource 版的 `detach`。 |
| `dispose()` | 无 | `void` | 同步 | 关闭 scope、启动全部 owned cleanup；不等待 Store thenable。 |
| `disposeAsync()` | 无 | `Promise<void>` | 异步 single-flight | 关闭并等待全部 cleanup，稳定重放完成或失败。 |

`key` 不能为空字符串,也不能是 `'__proto__'`,否则抛 `Error('[store] invalid SSR store key')`——这条限制对 Store 和 Resource 的 key 都生效,是防止原型污染的第一道关卡。

**归属校验**:`register()` 要求 `store.$runtime === scope.runtime`,不满足抛出 `Error('[store] SSR store "${key}" belongs to a different Runtime')`;`registerResource()` 同理。**重复 key** 直接抛 `Error('[store] duplicate SSR store key: ${key}')`(Resource 版消息里是 `SSR resource`),不会静默覆盖已有注册。

**`options.owned`**(默认 `true`)决定这个 Store/Resource 是否由 scope"拥有"——owned 的条目会在 `dispose()` 时被自动 `$dispose()`/`dispose()`;传 `owned: false` 表示调用方自己管理生命周期,scope 只负责脱水/复水,不负责销毁。

**注册顺序与待处理的 hydrate**:如果在这个 key 注册之前,scope 已经通过 `hydrate()` 收到过一份还没人认领的快照,`register()`/`registerResource()` 会在**登记生效之前**先把这份待处理快照应用到新传入的 Store/Resource 上——如果 `$hydrate()`/`hydrate()` 在这一步抛错,注册整体失败,这个 key 保持"空闲"状态,待处理快照也原样保留,方便调用方修好问题后重试同一个 key,而不是陷入"key 已被占用但没有正常内容"的僵局。

---

## 6. hydrate() 完整语义

```ts
scope.hydrate(state); // state: ISSRState
```

`hydrate()` 做的事:对 `state.stores` 里的每个 key,如果已有对应注册,调用 `store.$hydrate(plain)`;如果还没注册,把这份数据存进"待处理"表,等以后 `register()` 同一个 key 时自动应用(见上一节)。`state.resources` 同理,只是走 `resource.hydrate(snapshot)`。

**这是尽力而为(best-effort),不是原子操作**。某个 Store/Resource 的 `hydrate` 方法自己抛错,不会阻止其余条目继续处理——所有条目都会被尝试一遍,失败的收集起来,最后统一抛出:只有一个失败时直接抛出那个原始 error;多个失败时抛出一个 `AggregateError`,消息是 `'[store] SSR hydrate() failed for one or more stores/resources; entries that could apply were still applied (best-effort, not atomic)'`。调用之前,`state` 会先经过 `assertSSRState()` 校验(见 [§10](#10-issrstate-校验规则与-json-安全限制)),格式不对会在真正尝试 hydrate 任何一个条目之前就抛错。

待处理表每次调用 `hydrate()` 都会**整体替换**:新调用里没出现的 key 不会保留上一次遗留的待处理快照。

---

## 7. dehydrate() 与 dehydrateTrusted()

### `dehydrate()`

```ts
const state: ISSRState = scope.dehydrate();
```

按 key 字典序遍历所有已注册且未销毁(`$disposed`/`disposed` 为 `false`)的 Store 和 Resource:Store 调用 `$plain()`,结果经过深度校验 + 深拷贝 + 冻结,产出 JSON-safe 的 `Readonly<Record<string, IJSONValue>>`;Resource 调用 `dehydrate()`,返回 `undefined` 的直接跳过(表示还没有成功值可脱水),有值的话只对 `snapshot.data` 做同样的深拷贝校验,`version`/`updatedAt`/`expiresAt` 原样保留。返回值整体 `Object.freeze`,`stores`/`resources` 各自也是冻结对象。

### `dehydrateTrusted()`

```ts
const trusted: ITrustedSSRState = scope.dehydrateTrusted();
const text = serializeTrustedSSRState(trusted); // 必须紧跟着调用,中间不能有别的异步/mutation
```

`dehydrateTrusted()` 是内部快速路径,**不是快照**:返回值里的每一个值都是 `$plain()`/`dehydrate()` 当场返回的活引用,不拷贝、不深度冻结、也不做 JSON 校验。如果 Store 在这次调用之后、真正序列化之前发生了变化(一次 await、一次排队的写入),载荷内容会跟着变,没有任何时点保证。只有在"每个值都已经是已知安全、当前调用期间不会被并发修改的数据"时才该用它——例如库自带的固定文档/演示内容,绝不应该是来自请求输入或可能并发变化的 Store。`dehydrate()` 几乎总是你想要的方法;只有在明确要规避 `dehydrate()` 的校验/拷贝开销、并且能说清楚为什么这里跳过是安全的时候,才选 `dehydrateTrusted()`。

返回类型 `ITrustedSSRState` 带一个不可外部构造的品牌(`trustedSSRBrand`),`serializeTrustedSSRState()` 只接受这个品牌类型的输入——防止把一个未经这条路径产出的普通对象误传进去。

---

## 8. awaitResources() 与 dehydrateAsync()

### `awaitResources(options?)`

```ts
const failures: readonly ISSRResourceFailure[] = await scope.awaitResources({ timeoutMs: 3000 });
```

| 选项 | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `timeoutMs` | `number` | 可选 | 不设超时 | 整个等待过程的总预算,不是单个 Resource 各自的超时。`0` 合法,语义是"立刻过期"——不等待任何在途 Resource。 |

传入非法值(不是有限数字,或为负数)会同步抛出 `RangeError('[store] SSR awaitResources timeoutMs must be finite and non-negative')`。

逐轮 settle 是这个方法的核心行为:每一轮只等待"这一轮新出现的 Promise",按 **Promise 身份**去重而不是按 key——同一个 key 首次 settle 后又发起了 retry/refetch(拿到一个新 Promise),仍然会被继续等到,不会因为这个 key "见过"就永久跳过。这样设计是为了正确处理瀑布式注册(Resource A resolve 之后的回调里才注册 Resource B)——旧版本用一趟 `Promise.all` 时,B 根本来不及被等到,`dehydrate()` 时它还没准备好,预取等于白做。

三种失败旁路都会被收进 `failures` 清单,不会让任何一种绕过其余处理直接中止整个等待:

- 读取 `resource.promise` 这个 getter 本身同步抛错(某 key 只记一次,避免持续抛错的 key 每轮重复报错);
- 单个 Resource 在 `timeoutMs` 预算耗尽后仍未 settle,错误信息是 `'[store] SSR resource "${key}" did not settle within ${timeoutMs}ms'`;
- 等待期间 `scope.dispose()` 被调用——这种情况直接返回已经收集到的结果,不算作剩余 Resource 的失败。

Resource 的完成回调里无限注册新 Resource 属于调用方的 bug,但不能让它把渲染线程永远吊住:轮次上限是 64(`MAX_RESOURCE_ROUNDS`),超过会抛出 `Error('[store] SSR resources kept registering new resources past 64 rounds')`。

### `dehydrateAsync(options?)`

```ts
const state = await scope.dehydrateAsync({
  timeoutMs: 3000,
  onResourceError: (failure) => log.warn('resource failed', failure)
});
```

等价于先 `awaitResources({ timeoutMs })`,再 `dehydrate()`。每个失败默认转发给 `scope.runtime.reportError(failure.error, { phase: 'ssr-resource' })`(`@migaia/reactive` 的 `IRuntimeErrorPhase` 里专门为这个场景保留了 `'ssr-resource'`);传入 `onResourceError` 会**替代**默认行为,而不是在默认行为之外追加——只调用你传入的回调。**失败的 Resource 不会出现在返回的 `state.resources` 里**,其余成功的 Resource 和全部 Store 照常打包,不会因为一个 Resource 挂了就让整页脱水失败。

---

## 9. dispose() 完整语义

```ts
scope.dispose();
await scope.disposeAsync(); // 请求结束的推荐边界：等待所有异步 Store cleanup
```

重复调用是安全的(`disposed` 已为真时直接返回,不重复执行)。销毁顺序:先按注册顺序的**逆序**销毁 owned 的 Resource,再逆序销毁 owned 的 Store(未标记 `owned: false`、且尚未 `disposed`/`$disposed` 的才会被销毁)。所有内部表(`registrations`、`resources`、待处理 hydrate)会先清空,再逐个尝试销毁——某一个 `$dispose()`/`dispose()` 抛错不会阻止其余条目继续销毁,错误收集起来最后统一抛出:一个失败直接抛出原始 error,多个失败抛出 `AggregateError('[store] SSR request scope disposal failed')`。

`disposeAsync()` 是 single-flight 的最终释放边界：首次调用会触发 `dispose()`（若尚未调用），等待所有 Store `$dispose()` thenable settle，并按同一单错/多错规则拒绝；并发、完成后或失败后重复调用均返回同一 Promise。`dispose()` 保持同步关闭语义，但不能证明异步 Store cleanup 已完成。

`dispose()` 还会 resolve 一个内部信号(`#disposedSignal`),这正是 `awaitResources()` 能在等待期间被 dispose 打断的机制——不需要等到当前这一轮 `Promise.allSettled` 结束才发现请求已经断开。

`dispose()` 之后,`register`/`unregister`/`detach`/对应 Resource 方法/`hydrate`/`dehydrate`/`dehydrateTrusted`/`awaitResources` 全部会因为内部的 `#assertActive()` 检查而抛出 `Error('[store] SSR request scope is disposed')`——scope 是一次性的,不支持"销毁后复用"。

---

## 10. ISSRState 校验规则与 JSON 安全限制

```ts
type ISSRState = {
  readonly version: 1;
  readonly stores: Readonly<Record<string, Readonly<Record<string, IJSONValue>>>>;
  readonly resources?: Readonly<Record<string, IResourceCacheSnapshot<IJSONValue>>>;
};
```

`assertSSRState(value)` 是所有反序列化入口(`deserializeSSRState`、`hydrate()`、`readSSRStateFromDocumentWith`)共用的校验函数,规则:

- 必须是纯对象且 `version === 1`,否则 `Error('[store] invalid SSR state version')`。
- `stores` 必须是纯对象,否则 `Error('[store] invalid SSR stores snapshot')`;每个 key 都要通过 `assertStoreKey`(非空、不是 `'__proto__'`),每个 value 必须是合法 JSON 对象。
- `resources`(可选)必须是纯对象,否则 `Error('[store] invalid SSR resources snapshot')`;每个 value 必须是纯对象、`version === 1`、`updatedAt` 是有限数字、`expiresAt` 是 `null` 或有限数字,否则 `Error('[store] invalid SSR resource snapshot: ${key}')`;`data` 字段再走一遍 JSON 合法性校验。

JSON 合法性校验(`dehydrate()` 的深拷贝路径与纯校验路径共用同一套判定顺序,保证同一份非法数据在两条路上报出一致的原因)拒绝:

| 情形 | 报错 |
| --- | --- |
| 非纯对象(有自定义原型的实例、`Map`/`Set`/`Date` 等) | `TypeError('${path} contains a non-plain object')` |
| 非有限数字(`NaN`/`Infinity`) | `TypeError('${path} contains a non-finite number')` |
| 不是 `string`/`boolean`/`number`/`null`/纯对象/数组 | `TypeError('${path} is not JSON serializable')` |
| 循环引用(同一个对象在自己的子树里再次出现) | `TypeError('${path} contains a cycle')` |
| 嵌套深度超过 256 层(`MAX_JSON_DEPTH`) | `TypeError('${path} exceeds the JSON depth limit')` |
| 节点总数超过 1,000,000(`MAX_JSON_NODES`) | `TypeError('${path} exceeds the JSON node limit')` |

`path` 会精确到具体字段,比如 `stores.app.count` 或 `resources.user.data[2].name`,方便定位是哪个 Store/Resource 的哪个字段出的问题。

---

## 11. 内联进 HTML:纯 JSON 版本

```ts
// 写入
const html = createSSRStateScript(state); // 默认 elementId = '__STORE_STATE__'
// => <script type="application/json" id="__STORE_STATE__">{"version":1,...}</script>

// 读取(浏览器端)
const state = readSSRStateFromDocument(); // 默认同一个 elementId
```

| 方法/签名 | 参数类型 | 同步/异步 | 说明 |
| --- | --- | --- | --- |
| `serializeSSRState(state)` | `state: ISSRState` | 同步 | `assertSSRState` 校验 + `JSON.stringify` + HTML 转义,不做 `<script>` 包装。 |
| `deserializeSSRState(text)` | `text: string` | 同步 | `JSON.parse` + `assertSSRState`,格式不对直接抛错。 |
| `createSSRStateScript(state, elementId?)` | `state: ISSRState`；`elementId?: string`(默认 `'__STORE_STATE__'`) | 同步 | 生成完整的 `<script type="application/json">` 标签。 |
| `readSSRStateFromDocument(elementId?, document?)` | `elementId?: string`(默认 `'__STORE_STATE__'`)；`document?: ISSRDocument` | 同步 | 从 `document.getElementById(elementId).textContent` 读回并反序列化;元素不存在或内容为空返回 `undefined`。 |

**HTML 转义细节**:`serializeSSRState` 对 `&`、`<`、`>`、` `、` ` 做单次正则扫描替换(不是五次 `replaceAll`——SSR 载荷通常是这份数据里最大的字符串,单次扫描明显更快),分别转成 `&`/`<`/`>`/` `/` `,防止载荷里出现 `</script>` 之类的字符串提前闭合标签,也避免 U+2028/U+2029 在某些解析路径下被当成行终止符。

**`elementId` 校验**:必须匹配 `/^[A-Za-z_][A-Za-z0-9_:.-]*$/`(首字符允许下划线,是为了让默认值 `__STORE_STATE__` 本身合法),不匹配抛出 `Error('[store] invalid SSR state script id')`。这个正则本身就排除了空白和引号,所以纯 JSON 版本不需要对 `elementId` 再单独做属性转义。

`ISSRDocument` 是这个包定义的最小文档接口,只要求 `getElementById(id)` 返回 `{ textContent, getAttribute(name) } | null`——浏览器的真实 `document` 满足它,测试里传一个手写的 mock 对象也可以。

---

## 12. 内联进 HTML:多编解码器版本

当 SSR 载荷需要用 JSON 以外的格式(自定义压缩、二进制编解码)传输时,用这一组 API,接 `@migaia/serialize` 的 `ISerializeRegistry`:

```ts
import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize';
import { createSSRStateScriptWith, readSSRStateFromDocumentWith } from '@migaia/store-ssr';

const codecs = createSerializeRegistry([jsonPlugin()]);

// 写入
const html = await createSSRStateScriptWith(state, { codecs });

// 读取
const state = await readSSRStateFromDocumentWith({ codecs, document });
```

| 选项(`ISSRScriptOptions` / `ISSRReadOptions`) | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `codecs` | `ISerializeRegistry` | 必填 | — | 决定实际写入格式的是 `codecs.primaryType`(注册表里第一个插件)。 |
| `elementId` | `string` | 可选 | `'__STORE_STATE__'` | 与纯 JSON 版本共用同一条 `elementId` 校验正则。 |
| `signal` | `AbortSignal` | 可选 | — | 透传给 `codecs.encode`/`codecs.decode`。 |
| `document`(仅读取) | `ISSRDocument` | 可选 | — | 不传时视为找不到元素,返回 `undefined`。 |

**写入格式的选择逻辑**:`codecs.encode(state, ...)` 产出的 chunk 如果是 `['value', ...]` 会直接抛 `TypeError('[store] SSR codec ${type} must produce wire data, not a value chunk')`——SSR 载荷必须是真正的线上数据(text/bytes),不能是内存里的值引用。如果 `type === 'json'` 且产出的是 `['text', ...]`,走和纯 JSON 版本一样的 HTML 转义,标签属性是 `data-codec="json" data-wire="text"`;其余任何情况(非 JSON 格式,或 JSON 编码成了字节)一律 base64 编码,标签属性是 `data-wire="b64"`,`type="text/plain"`(不是 `application/json`,避免浏览器把非 JSON 的载荷当作可执行内容对待)。**非 JSON 格式一律 base64,不做字符级转义**——转义规则(比如 `<` 只在 JSON 语法里安全)套到 YAML 或二进制格式上会破坏数据本身,base64 字母表天然不含 `<`/`>`/`&`/换行,可以安全内联,代价是体积膨胀约三分之一。

`elementId` 会经过属性转义(`&`/`"`/`'`/`<`/`>` 分别转 HTML 实体)后再写进 `id="..."` 属性——这一版本的 `elementId` 虽然也过同一条正则,但属性转义是第二道防线,防止未来正则被放宽或有代码绕开校验直接拼接。

**读取时**:优先读 `data-codec`(缺省 `'json'`)和 `data-wire`(缺省 `'text'`)属性决定怎么解码;如果 `data-codec` 标注的类型没有注册到传入的 `codecs` 里,抛出 `Error('[store] SSR payload was written by codec "${type}", which is not registered')`——写入和读取必须使用兼容的 registry 配置。解码结果最终仍会过一遍 `assertSSRState`,格式不对同样会抛错。

---

## 13. 错误一览表

| 错误 | 触发条件 |
| --- | --- |
| `Error('[store] SSR scope accepts runtime or runtimeOptions, not both')` | 构造 `SSRRequestScope` 时两个选项都传了 |
| `Error('[store] invalid SSR store key')` | `register`/`registerResource` 的 key 为空或是 `'__proto__'` |
| `Error('[store] SSR store "<key>" belongs to a different Runtime')` | 注册的 Store 不属于这个 scope 的 Runtime |
| `Error('[store] SSR resource "<key>" belongs to a different Runtime')` | 注册的 Resource 不属于这个 scope 的 Runtime |
| `Error('[store] duplicate SSR store key: <key>')` | 重复注册同一个 Store key |
| `Error('[store] duplicate SSR resource key: <key>')` | 重复注册同一个 Resource key |
| `Error` / `AggregateError('[store] SSR hydrate() failed ...')` | `hydrate()` 时一个或多个条目的 `$hydrate`/`hydrate` 抛错 |
| `RangeError('[store] SSR awaitResources timeoutMs must be finite and non-negative')` | `timeoutMs` 不是有限数字或为负 |
| `Error('[store] SSR resource "<key>" did not settle within <ms>ms')` | 单个 Resource 在预算内未 settle(仅出现在 `awaitResources` 返回的失败清单里,不会被抛出) |
| `Error('[store] SSR resources kept registering new resources past 64 rounds')` | 瀑布式注册超过轮次上限 |
| `Error` / `AggregateError('[store] SSR request scope disposal failed')` | `dispose()` 时一个或多个 owned 条目的销毁方法抛错 |
| `Error('[store] SSR request scope is disposed')` | 在已 `dispose()` 的 scope 上调用其余方法 |
| `Error('[store] invalid SSR state version')` | 反序列化/hydrate 的数据 `version !== 1` 或不是纯对象 |
| `Error('[store] invalid SSR stores snapshot')` / `'invalid SSR resources snapshot'` | `stores`/`resources` 不是纯对象 |
| `Error('[store] invalid SSR resource snapshot: <key>')` | 单个 resource 快照缺字段/字段类型不对 |
| `TypeError('<path> ...')` 系列(非纯对象/非有限数字/不可 JSON 序列化/循环引用/深度超限/节点数超限) | 脱水或校验时遇到不合法的 JSON 值,见 [§10](#10-issrstate-校验规则与-json-安全限制) |
| `Error('[store] invalid SSR state script id')` | `elementId` 不匹配允许的字符集 |
| `TypeError('[store] SSR codec <type> must produce wire data, not a value chunk')` | 编解码器的 `encode` 产出了 value chunk 而不是线上数据 |
| `Error('[store] SSR payload was written by codec "<type>", which is not registered')` | 读取时 `data-codec` 标注的类型未注册进传入的 `codecs` |

---

## 14. 生产环境完整示例

```ts
// server.ts —— 带异步 Resource 预取的完整请求处理流程
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
      onResourceError: (failure) => console.warn(`[ssr] resource "${failure.key}" failed`, failure.error)
    });

    return `<!doctype html><html><body>${createSSRStateScript(state)}<div id="root"></div></body></html>`;
  } finally {
    scope.dispose(); // 无论成功失败,请求结束都要释放这个请求专属的 Runtime
  }
}
```

```ts
// client.ts —— 浏览器端复水
import { createStore } from '@migaia/store-light';
import { Resource } from '@migaia/resource';
import { readSSRStateFromDocument } from '@migaia/store-ssr';

const runtime = createRuntime(); // 客户端自己的 Runtime,与服务端隔离
const app = createStore({ theme: 'dark' }, { runtime });
const user = new Resource(fetchUser, runtime, { ttl: 30_000, autoStart: false });

const state = readSSRStateFromDocument();
if (state) {
  if (state.stores.app) app.$hydrate(state.stores.app);
  if (state.resources?.user) user.hydrate(state.resources.user);
}
```

---

## 15. 常见问题排查

**Q:`register()` 报 "belongs to a different Runtime"。**
Store/Resource 创建时用的 `runtime` 参数,必须是 `scope.runtime`,不能是全局默认 Runtime,也不能是另一个请求/另一个 scope 的 Runtime。检查创建 Store 时传的 `{ runtime: scope.runtime }` 是否写对。

**Q:`dehydrateAsync()` 拿到的 `state.resources` 里少了某个 key。**
两种可能:该 Resource 的 `dehydrate()` 返回了 `undefined`(还没有成功值,比如从未 `await` 过就直接脱水),或者它在 `awaitResources` 阶段超时/失败了——失败的 Resource 不会出现在最终结果里,检查有没有传 `onResourceError` 观察失败原因。

**Q:`hydrate()` 之后 Store 里的数据没变。**
确认 `hydrate()` 调用发生在对应 key 通过 `register()` 注册**之前还是之后**都可以——未匹配的快照会自动缓存并在注册时应用。真正的问题往往是 key 拼错,或者 `state.stores` 里根本没有这个 key(检查服务端 `dehydrate()` 时这个 Store 是否已经 `$disposed`——已销毁的 Store 会被跳过,不会出现在脱水结果里)。

**Q:内联的 `<script>` 标签在页面里看不到预期内容,或者报 JSON 解析错误。**
确认写入和读取用的是同一个 `elementId`;如果用的是 `createSSRStateScriptWith`,还要确认读取时传入的 `codecs` 至少注册了写入时用的那个 `type`,否则会直接抛 "which is not registered"。

**Q:`awaitResources()` 一直不返回。**
检查是否设置了 `timeoutMs`——不设置的话会一直等到所有 Resource 的 Promise 都 settle,如果某个 Resource 的 fetcher 本身挂死(既不 resolve 也不 reject),这个等待没有内建的兜底超时。生产环境建议总是传一个 `timeoutMs`。
