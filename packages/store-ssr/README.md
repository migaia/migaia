# `@migaia/store-ssr`

为每次服务端渲染登记 Store 与 Resource，捕获可复水的状态，并在请求结束时清理所拥有的对象。

## 你可能遇到过

- 并发请求登记相同状态键，却读到了别人的值：模块级 Runtime 和共享登记表让请求数据归到了同一个所有者。
- 页面渲染时计数是 2，发送响应时却变成 3：响应仍指向活对象，没有捕获独立的数据副本。
- 一个请求还没完成，整份缓存就被当成超时：只给 Promise.all 加期限，无法区分已就绪与仍在途的资源。
- JSON 能解析，内联页面却被截断：JSON 字符串中的关闭脚本标签仍会被 HTML 解析器当作标记。

## 为什么选它

- **让误传的请求状态在登记时暴露。** 默认创建新 Runtime，登记时再检查精确身份，见[让两个请求使用各自的运行时](./USEGUIDE.md#让两个请求使用各自的运行时)。
- **固定渲染时捕获的值，并收拢请求清理。** 安全脱水校验、复制和冻结数据，默认拥有的 Store 随请求关闭释放，见[捕获请求快照并释放所拥有的状态](./USEGUIDE.md#捕获请求快照并释放所拥有的状态)。
- **分别识别就绪缓存与在途超时。** 等待按 Promise 结算情况分类，零预算也识别已完成结果，见[保留就绪数据并报告仍在途的资源](./USEGUIDE.md#保留就绪数据并报告仍在途的资源)。
- **把 HTML 中的 JSON 正文转义集中到一个入口。** 序列化转义五类敏感字符并保留 JSON 读回值，见[内联 JSON 时避免数据提前关闭脚本元素](./USEGUIDE.md#内联-json-时避免数据提前关闭脚本元素)。
- **用经过校验的标识生成一致的状态元素。** 标签生成器固定 JSON MIME 类型并拒绝突破属性边界的标识，见[拒绝会破坏状态元素属性的标识符](./USEGUIDE.md#拒绝会破坏状态元素属性的标识符)。

## 从这里开始

先安装本包与直接使用的 Store：

```bash
pnpm add @migaia/store-ssr @migaia/store-light
```

```ts doc-test=run
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createStore } from '@migaia/store-light'

const scope = createSSRRequestScope()
const cart = createStore({ count: 2 }, { runtime: scope.runtime })
scope.register('cart', cart)
const snapshot = scope.dehydrate()
cart.count = 3
console.log(snapshot.stores.cart?.count, cart.count)
console.log(Object.isFrozen(snapshot.stores.cart))
await scope.disposeAsync()
console.log(cart.$disposed)
```

输出：

```text
2 3
true
true
```

下一步：查看[两个请求的隔离](./USEGUIDE.md#让两个请求使用各自的运行时)，或[等待资源后脱水](./USEGUIDE.md#保留就绪数据并报告仍在途的资源)。

## 手写时的隐患

以下原生写法只展示，不执行；它把请求登记、数据捕获和 HTML 嵌入的责任留在了业务代码里。

```ts doc-test=check
const sharedState = { cart: { count: 2 } } // 隐患：模块级状态可被多个请求共享。

function renderRequest() {
  const payload = { version: 1, stores: sharedState } // 隐患：嵌套值仍是活引用。
  return `<script type="application/json">${JSON.stringify(payload)}</script>` // 隐患：正文未处理关闭标签。
}

void renderRequest
```

## 三分钟心智模型

每请求创建一个作用域，用它的 Runtime 创建状态，再登记、渲染、脱水；响应完成后等待清理，浏览器用相同键复水。

| 术语                | 含义                                    | 本包对应入口                                  |
| ------------------- | --------------------------------------- | --------------------------------------------- |
| 请求作用域（scope） | 保存本请求登记与待复水状态的对象        | createSSRRequestScope；应用决定每请求创建一次 |
| 运行时（Runtime）   | 状态与反应式调度的归属                  | scope.runtime；登记检查精确对象身份           |
| 脱水 / 复水         | 从状态捕获 JSON 数据 / 把数据应用回状态 | dehydrate / hydrate；复水可部分成功           |
| 拥有（owned）       | 是否由请求关闭负责释放                  | 登记默认 true；detach 转交给调用者            |
| 状态元素            | HTML 中承载数据的非执行脚本             | createSSRStateScript；读取时显式传 document   |

## 典型场景

| 场景                                 | 怎么组合                                                      | 详细说明                                                       |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 捕获请求快照并释放所拥有的状态       | `createSSRRequestScope → register → dehydrate → disposeAsync` | [完整示例](./USEGUIDE.md#捕获请求快照并释放所拥有的状态)       |
| 让两个请求使用各自的运行时           | `createSSRRequestScope × 2 → register → dehydrate`            | [完整示例](./USEGUIDE.md#让两个请求使用各自的运行时)           |
| 保留就绪数据并报告仍在途的资源       | `registerResource → dehydrateAsync → disposeAsync`            | [完整示例](./USEGUIDE.md#保留就绪数据并报告仍在途的资源)       |
| 内联 JSON 时避免数据提前关闭脚本元素 | `serializeSSRState → deserializeSSRState`                     | [完整示例](./USEGUIDE.md#内联-json-时避免数据提前关闭脚本元素) |
| 生成完整的不可执行状态元素           | `createSSRStateScript(state)`                                 | [完整示例](./USEGUIDE.md#生成完整的不可执行状态元素)           |
| 拒绝会破坏状态元素属性的标识符       | `createSSRStateScript(state, elementId)`                      | [完整示例](./USEGUIDE.md#拒绝会破坏状态元素属性的标识符)       |

## 安装

```bash
pnpm add @migaia/store-ssr
```

只使用根入口时安装本包；本页及指南的真实 Store/Resource 场景还直接导入以下两个包，因此一并安装：

```bash
pnpm add @migaia/store-ssr @migaia/store-light @migaia/resource
```

## 常用 API

| API                                       | 用途                               |
| ----------------------------------------- | ---------------------------------- |
| `createSSRRequestScope(options?)`         | 为一次请求建立登记与清理边界       |
| `scope.register / registerResource`       | 登记同 Runtime 的 Store / Resource |
| `scope.hydrate(state)`                    | 复水已登记对象或暂存未知键         |
| `scope.dehydrate / dehydrateAsync`        | 捕获快照，可先等待资源             |
| `scope.disposeAsync()`                    | 关闭请求并等待 owned 清理          |
| `createSSRStateScript(state, elementId?)` | 生成转义后的 JSON 状态元素         |

## 契约细节

### 职责、入口与请求归属

本包只有根入口 `@migaia/store-ssr`。它连接 reactive 驱动的 Store/Resource 与 SSR 快照，管理请求内登记、预取等待、脱水、复水和已接纳对象的清理；依赖 reactive、resource、serialize、utils，不绑定渲染框架，也不读 globalThis.document。

每个请求默认创建新的 SSRRequestScope 和 Runtime。register 检查 store.$runtime，registerResource 检查 resource.runtime，必须等于 scope.runtime；不匹配抛 CROSS_RUNTIME。claimOwnership 登记 scope 对象的归属，不独占 Runtime：调用方显式传同一个 Runtime 给两个 scope 是允许的，库无法据此自动隔离请求。正确的接入是每请求创建独立 scope，用 scope.runtime 创建该请求状态，并在 finally 中 await disposeAsync。

createStore 返回值和 Resource 类分别满足下文的 Store/Resource 接口，不需要另造适配层。纯客户端应用不需要这座 SSR 桥；它也不是通用的任意对象 JSON 转换器。客户端是否重发数据请求还取决于 Resource 的缓存、TTL 和启动策略，复水不保证所有业务都不再请求。

### 创建与结构接口

createSSRRequestScope(options?) 等价于 new SSRRequestScope(options?)，options 默认空对象：

| 字段                             | 默认与边界                                         |
| -------------------------------- | -------------------------------------------------- |
| runtime?: IRuntime               | 未提供时内部 createRuntime() 新建；显式提供时复用  |
| runtimeOptions?: IRuntimeOptions | undefined；转给内部 createRuntime，与 runtime 互斥 |

runtimeOptions 是 reactive 的选项，包含 onError、onTrace、maxFlushPasses、scheduleIdle 等，由 reactive 定义具体语义；本包没有另建运行时选项。两项同时提供以 INVALID_OPTION 拒绝。scope.runtime 只读，scope.disposed 表示已开始同步关闭。

| Store port                                       | Resource port                                                 |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `readonly $runtime: IRuntime`                    | `readonly runtime: IRuntime`                                  |
| `readonly $disposed: boolean`                    | `readonly disposed: boolean`                                  |
| `$plain(): Record<string, unknown>`              | `readonly promise: Promise<unknown>`                          |
| `$hydrate(state: Record<string, unknown>): void` | `dehydrate(): IResourceCacheSnapshot<unknown>` 或 `undefined` |
| `$dispose(): void` 或 `PromiseLike<void>`        | `hydrate(snapshot): void`；`dispose(): void`                  |

Resource 没有可脱水缓存时可返回 undefined。Store 使用 $ 前缀、Resource 不使用，是各自原接口的约定。异步 Store cleanup 由 scope 观察；Resource port 的 dispose 是同步接口。结构适配器必须按自身缓存策略提供 dehydrate，不能假设失败记录会替它决定是否输出缓存。

### 登记、注销与所有权

| 方法                                      | 参数、默认值与结果                                          |
| ----------------------------------------- | ----------------------------------------------------------- |
| register(key, store, options?)            | key/store 必填，options 默认 {}，owned 默认 true；返回 void |
| unregister(key, disposeOwned?)            | key 必填，disposeOwned 默认 true；返回是否找到登记          |
| detach(key)                               | 返回原 Store 或 undefined，只移除不销毁                     |
| registerResource(key, resource, options?) | Resource 版本，同样默认 owned true                          |
| unregisterResource(key, disposeOwned?)    | Resource 版本，返回是否找到登记                             |
| detachResource(key)                       | 返回原 Resource 或 undefined，只移除不销毁                  |

key 必须非空且不能为 `__proto__`。Store 与 Resource 各自的重复 key 以 INVALID_OPTION 拒绝，不静默覆盖。登记对象必须属于当前 Runtime。owned true 在 scope 退出时负责清理；owned false 只参与脱水/复水，资源仍归调用方。

hydrate 先于登记到达时，register 会在提交登记前应用同 key 待处理快照。回调失败且 scope 仍活跃时，key 仍空闲，待处理快照保留以便重试，候选仍归调用方；若回调关闭了 scope，关闭会清空待处理表，提交前再次拒绝 SCOPE_DISPOSED，候选可能已被水合但未被接纳。

Store 注销先摘登记再启动 $dispose，thenable 由 scope 追踪；Resource 注销先调用 dispose，若同步失败，登记仍在，可由调用方 detach 或处理后重试。detach 从不销毁，成功后生命周期责任转给调用方。

### hydrate：可部分成功的复水

hydrate(state) 只有必填 state 参数，无额外选项。先 assertSSRState 校验全部结构，再对已登记对象调用 $hydrate/hydrate，未知 key 放入待处理表，之后同 key 登记时应用。每次 hydrate 整体替换待处理表，新状态未包含的旧待处理项不保留。

这是尽力而为的操作，不是原子事务。一个回调失败不阻止其他条目尝试，已经应用的状态不回滚。单个失败原样抛出；多个失败通过 HYDRATE_FAILED 的 AggregateError.errors 保留原对象和顺序。key 拼写、快照是否含该 key 及服务端脱水时对象是否已销毁，都影响客户端恢复结果。

### dehydrate 与 trusted 路径

dehydrate() 无参数，按 key 字典序遍历未销毁的已登记对象。Store 的 $plain() 经 JSON 校验、深拷贝和冻结；Resource 的 dehydrate() 返回 undefined 时跳过，有值时只对 data 深拷贝校验，保留 version、ageMs、remainingTtlMs。外层 state、stores、resources 都冻结，脱水后源对象变化不改变这份安全快照。

dehydrateTrusted() 无参数，但它**不是快照**。它保留 $plain()/dehydrate() 的活引用，不做 JSON 校验、深拷贝或深冻结；只有外层包装不等于整棵数据不可变。ITrustedSSRState 有不可外部构造的类型品牌，serializeTrustedSSRState 只接受这条路径产出的类型，不是对不可信数据的安全证明。

选择 trusted 路径必须已知所有值合法且不会在序列化前改变，随后立即 serializeTrustedSSRState，中间不要 await 或 mutation。默认使用 dehydrate，不能因为有品牌就把请求输入当作已验证数据。dehydrate/dehydrateAsync 只产出数据，不负责 HTML 字符转义。

### 资源等待与失败报告

awaitResources(options?) 返回 readonly ISSRResourceFailure[]；每项包含 key 和原始 error。options 默认 {}，timeoutMs 默认 undefined，不设期限；提供时须为 [0, 2147483647] 内的有限非负数，可为小数，非法值让返回 Promise 以 RangeError / INVALID_OPTION 拒绝。

timeoutMs 是整个等待的总预算，不是每个 Resource 各得一份。逐轮按 Promise 身份去重，新 retry/refetch Promise 仍会被等待；瀑布式完成后登记的新 Resource 也会进入后续轮次。超过 64 轮以 RESOURCE_ROUND_LIMIT 拒绝。

读取 promise getter 的失败按 key 只记一次；原 Promise 拒绝保留其原因；预算耗尽只把仍 pending 的 Promise 记为 RESOURCE_TIMEOUT，已成功的不误报。timeoutMs 0 不等在途任务，但仍识别已完成 Promise。scope 关闭会让等待尽快返回已收集失败，不把剩余项统一报超时，也不取消这些 Resource 的底层工作。

dehydrateAsync(options?) 先等待再安全脱水，字段 timeoutMs 同上；onResourceError(failure) 可选，无默认用户回调。未传时每项失败交 runtime.reportError(error, { phase: 'ssr-resource' })，传入后替代默认报告。失败清单不按 key 另行删除 state.resources，是否输出由 Resource.dehydrate() 决定。没有期限的永不 settle 工作可一直等待，调用方应按请求预算显式选择 timeoutMs。

Resource v2 hydration 恢复捕获时的剩余 TTL。已知传输或存储耗时应由调用方计入 ageMs，并从有限 remainingTtlMs 扣除、最低为 0；外层 ISSRState.version 仍是 1。

### scope 退出与稳定完成

dispose() 无参数，同步关闭入口并启动清理；disposeAsync() 无参数，返回稳定的 Promise<void>。首次关闭先标记 disposed、清空登记与待水合表并发布完成 Promise，再执行回调。因此清理中的同步重入也取得同一个完成 Promise；重复调用、完成后与失败后均稳定复用，不再释放一次。

释放顺序是注册逆序的 owned Resource，再注册逆序的 owned Store，已销毁项跳过。每项失败不阻断其余项。同步 dispose 可抛同步失败，但不等待异步 Store thenable；disposeAsync 等全部已追踪清理完成，单错保留原对象，多错以 SCOPE_DISPOSAL_FAILED 的 AggregateError.errors 汇总。它也等待由此前 unregister 启动、仍在追踪的 Store cleanup。

scope 不销毁 Runtime 本体。关闭后除 runtime/disposed 观察和幂等关闭外，登记、注销、detach、hydrate、脱水与资源等待以 SCOPE_DISPOSED 失败；同步方法抛错，异步等待方法拒绝。scope 一次性使用，不支持复活。

### ISSRState 与 JSON 规则

ISSRState 要求 version: 1、stores 普通对象；resources 可选。每个 Store 值必须是 JSON 对象，key 非空且不为 `__proto__`。Resource 快照要求 version: 2、data、有限非负 ageMs，以及 null 或有限非负 remainingTtlMs。assertSSRState(value) 只有必填 value，无选项，校验通过后收窄类型，不是创建一份深拷贝。

JSON 域是 null、字符串、布尔、有限数、普通对象与数组。拒绝 Date/Map/Set/类实例、非有限数、undefined/函数/symbol/bigint 等非 JSON 类型、祖先循环、深度超过 256、节点超过 1000000；路径指向 stores.app.count 或 resources.user.data[2].name 等位置。相同无环对象的重复引用不等于祖先循环。拷贝与纯校验共享同一判定顺序。

INVALID_SNAPSHOT 用于 stores/resources 结构与资源快照错误；外层版本错误为 INVALID_STATE_SCRIPT。读取未知快照属性失败保留 native 原对象或 cause，不用新字符串替换失败。序列化不支持的 JSON 值为 TypeError / SERIALIZE_UNSUPPORTED。

### JSON 文本、HTML 嵌入与显式 document

serializeSSRState(state) 先校验、JSON.stringify，再对 &、<、>、U+2028、U+2029 做 JSON 兼容转义，返回文本，不包标签。serializeTrustedSSRState(state) 跳过校验但仍执行这些转义。两者各只有一个必填参数，不是任意 HTML 上下文的通用转义器。

转义结果分别含字面反斜杠序列 \u0026、\u003c、\u003e、\u2028、\u2029，防止 payload 的 `</script>` 提前结束对应 script；JSON.parse 仍读回原字符。deserializeSSRState(text) 执行 JSON.parse 和 assertSSRState，SyntaxError 原位附 INVALID_STATE_SCRIPT，保留原生类型与 stack。

createSSRStateScript(state, elementId?) 把安全文本放入完整 application/json script 标签。state 必填；elementId 默认 `__STORE_STATE__`，须匹配 `/^[A-Za-z_][A-Za-z0-9_:.-]*$/`，允许首个下划线并排除空白和引号，非法时 INVALID_STATE_SCRIPT。

readSSRStateFromDocument(elementId?, document?) 默认同一 id；document 默认 undefined，未传不读全局 DOM。document.getElementById(id) 返回含 textContent 与 getAttribute(name) 的元素或 null；没有元素或空内容返回 undefined。真实浏览器 document 满足此最小接口，非浏览器宿主也可显式实现它。返回数据仍须通过 SSR 校验。

### 多 codec script 与读回

createSSRStateScriptWith(state, options) 和 readSSRStateFromDocumentWith(options) 是异步 API，options 必填：

| 字段                       | 必填 / 默认                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| codecs: ISerializeRegistry | 必填，无默认；primaryType 选写入格式                             |
| elementId?: string         | 默认 `__STORE_STATE__`；写入端校验上述正则，读取端按 id 原样查找 |
| signal?                    | 默认 undefined，透传给 registry encode/decode                    |
| document?: ISSRDocument    | 仅读取，可选；省略返回 undefined                                 |

如果 encode 返回 value chunk，以 TypeError / CODEC_CONTRACT 拒绝：SSR 需要线上文本或字节。primaryType 为 json 且 chunk 为 text 时使用 JSON 字符转义，属性为 data-codec="json" data-wire="text"。其他情况，包括 JSON 的 bytes，使用 base64，data-wire="b64"、type="text/plain"；不能把 JSON 转义套到 YAML 或二进制语法上。base64 字母表避免相关 HTML 分隔字符，编码体积约增加三分之一，这是编码规则而非速度测量。

多 codec 标签的 id 及 codec 属性按 HTML 属性规则转义 &、双引号、单引号、<、>。这不替代 id 的准入规则。读者取 data-codec（默认 json）与 data-wire（默认 text）决定还原方式；未注册写入类型以 CODEC_CONTRACT 拒绝，解码后的结果仍经过 assertSSRState。写入和读取必须有兼容 registry，registry.encode 本身不代替 SSR helper 的嵌入策略。

SsrWireType 是 { json: 'json', text: 'text', bytes: 'bytes' }，ISsrWireType 为值联合。json 比较 codec type，text/bytes 比较 chunk kind，不能把这三个词混为同一层。内部等待标签 SsrWorkOutcome/ISsrWorkOutcome 已从根入口收回，不增加 wrapper 或兼容 alias；awaitResources 仍直接返回失败数组。

### 错误身份与工厂

本包构造错误的 source 为 STORE_SSR_SOURCE，即 @migaia/store-ssr；完整外包 source/code 保留原 owner。StoreSsrErrorCode 的 12 项如下：

| 属性 / code                                  | 场景                                            |
| -------------------------------------------- | ----------------------------------------------- |
| scopeDisposed / SCOPE_DISPOSED               | scope 已关闭后继续使用                          |
| scopeDisposalFailed / SCOPE_DISPOSAL_FAILED  | 多个 owned 清理失败，AggregateError 保留 errors |
| hydrateFailed / HYDRATE_FAILED               | 多条水合失败，非原子、其他成功不撤销            |
| invalidSnapshot / INVALID_SNAPSHOT           | stores/resources、Resource 快照或其属性读取非法 |
| invalidStateScript / INVALID_STATE_SCRIPT    | 外层版本、script id 或 JSON 解析非法            |
| invalidStoreKey / INVALID_STORE_KEY          | 注册键为空或 `__proto__`                        |
| serializeUnsupported / SERIALIZE_UNSUPPORTED | JSON 值域、循环或深度/节点预算不符              |
| invalidOption / INVALID_OPTION               | timeout、互斥 Runtime 选项、owned 或重复键非法  |
| crossRuntime / CROSS_RUNTIME                 | 登记对象不属于当前 Runtime                      |
| codecContract / CODEC_CONTRACT               | value chunk 或读者未注册对应 codec              |
| resourceRoundLimit / RESOURCE_ROUND_LIMIT    | 资源注册瀑布超过 64 轮                          |
| resourceTimeout / RESOURCE_TIMEOUT           | 某 pending Resource 到达总期限，记入失败数组    |

createStoreSsrError(code, message, options?) 构造 Error，options 可含 cause；createStoreSsrRangeError(code, message) 与 createStoreSsrTypeError(code, message) 仅两个参数，没有 cause 选项。code 和 message 必填，无默认。createStoreSsrAggregateError(code, errors, message) 构造 AggregateError，三参数必填，errors[] 保留原对象与顺序。工厂借 utils 的 attachErrorIdentity 附身份，不重写 stack。已有 native SyntaxError/TypeError 的准入失败在可附码时原位保留类型、实例和 stack，不可写或非 Error 原因通过 cause 保留。

### 端到端接入与维护

服务端每请求创建 scope，用 scope.runtime 创建真实 Store/Resource 并按 key 登记；有预取时 dehydrateAsync，随后用对应 serialize/script helper 输出，finally 中 await disposeAsync。浏览器创建自己的 Runtime 和状态对象，显式读取同 id，按同 key hydrate；Resource 的 autoStart、缓存和 TTL 由 resource 包及应用决定。注入 snapshot、发送响应和页面渲染都是宿主职责，本包不替应用创建请求上下文。

遇到 CROSS_RUNTIME 检查对象创建时是否传入 scope.runtime。水合没变化检查 key、服务端是否含该条目和对象是否已销毁。资源缺 key 应查看 dehydrate() 的返回值，而不是把 failure 名单当 payload 过滤器。脚本读回失败检查 id 和 codec 配置；等待不结束区分无期限的在途 Resource 与清理边界。

```bash
pnpm --filter @migaia/store-ssr run fmt
pnpm --filter @migaia/store-ssr run lint
pnpm --filter @migaia/store-ssr run typecheck
pnpm --filter @migaia/store-ssr run typecheck:test
pnpm --filter @migaia/store-ssr run test
pnpm --filter @migaia/store-ssr run build
```

已有测试覆盖隔离、脱水/复水、JSON 边界、资源等待、销毁顺序和错误身份；命令结果以实际执行为准。
