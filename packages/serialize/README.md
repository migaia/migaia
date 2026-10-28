# `@migaia/serialize`

[English](./README.en.md)

把格式选择、值校验、逐片编解码和解析器清理从存储与传输代码中分离，让旧存档、严格值域和大数组各走明确的入口。

## 你可能遇到过

- 新格式上线后旧存档读不了，根因是只替换解析器，没有保留已保存的格式标签与旧读取器。
- NaN 保存后变成 null，根因是把原生 JSON 的转换结果误当成已经通过业务校验。
- 同一份配置的三种文本内容不一致，根因是每种格式各自校验与拼接。
- 导出配置时 getter 意外执行，根因是读取了访问器，而不是先检查自有数据属性。
- 大数组输出前必须先构造整份字符串，根因是编码与下游消费没有按独立片段衔接。

## 为什么选它

- **新写入与旧读取可以并存。** 替换唯一解析器会遗失旧格式入口，registry 默认用首项写入，同时按保存的 type 选择旧 parser。[运行证明](./USEGUIDE.md#默认写新格式按已保存标签读旧格式)。
- **非有限数不会被悄悄存成 null。** 原生 JSON 会做这次替换，版本化 JSON codec 的 portable 规则会明确拒绝。[运行证明](./USEGUIDE.md#拒绝非有限计数避免悄悄存成-null)。
- **三种文本复用同一套输入边界。** 手写格式化容易改变保留字段，emitOutput 为 JSON/YAML/TOML 校验并投影普通数据。[运行证明](./USEGUIDE.md#把同一份配置导出为三种文本格式)。
- **配置 getter 在读取前被拒绝。** 直接复制或 stringify 会调用访问器，emitOutput 先检查描述符，拒绝时 getter 读取次数为零。[运行证明](./USEGUIDE.md#拒绝访问器字段不执行其读取代码)。
- **数组切片按独立编码帧交付。** 先整体编码必须等待完整结果，encodeStream 按片生成并限制在途请求，接收方无需先收集全部片段。[运行证明](./USEGUIDE.md#逐片处理数组不把多个-json-文档直接拼接)。

## 从这里开始

登记 JSON 插件，编码设置并用同一注册表读回：

```ts doc-test=run
import { createSerializeRegistry, jsonPlugin, chunkToText } from '@migaia/serialize'

const registry = createSerializeRegistry([jsonPlugin()])
const chunk = await registry.encode({ theme: 'dark' })
const restored = (await registry.decode(chunk)) as { theme: string }
console.log('格式:', registry.primaryType)
console.log('文本:', chunkToText(chunk, new TextDecoder()))
console.log('主题:', restored.theme)
await registry.dispose()
```

输出：

```text
格式: json
文本: {"theme":"dark"}
主题: dark
```

遇到旧格式迁移，看[保留旧读取器](./USEGUIDE.md#默认写新格式按已保存标签读旧格式)；遇到大数组输出，看[独立编码片段](./USEGUIDE.md#逐片处理数组不把多个-json-文档直接拼接)。

## 手写时的隐患

设置往返本身很简单，格式演进时还需要明确的读取器选择与字段策略。以下只展示隐患，不运行：

```ts doc-test=check
const saved = { chunk: JSON.stringify({ theme: 'dark', localCache: 'preview' }) } // 隐患：没有另存格式标签，无法按版本选择读取器。
const restored = JSON.parse(saved.chunk) as { theme: string } // 隐患：类型断言不会移除运行时仍在的缓存字段。
console.log(JSON.stringify(restored))
```

registry 集中登记和选择 parser，JSON replacer 可明确移除 localCache；格式标签仍由应用另存，chunk 本身不会自动带上 type；需要编码值携带 codec 身份时使用 tagged 入口。仅需一次普通 JSON 往返时，原生 API 已足够。

## 三分钟心智模型

| 你要处理的问题                    | 对应工具                              |
| --------------------------------- | ------------------------------------- |
| 统一插件格式选择与解析器清理      | registry + jsonPlugin 或自定义 parser |
| 严格跨格式数据域与版本身份        | 独立 codec 工厂                       |
| 导出普通配置为完整 JSON/YAML/TOML | emitOutput                            |
| 大数组逐片消费                    | encodeStream / decodeStream           |
| 目的地确实需要一个完整结果        | collectStream                         |

“chunk”是形态标签加一个载荷；“parser”实现编解码与可选释放；“plugin”把格式 type 与 parser 绑定；“registry”选择并持有这些实现；“portable”是格式之间接受的受限数据域；“背压”限制尚未完成或消费的工作数量；“帧”是接收方独立解码的一片，不等于连续文档的一部分。

## 典型场景

| 场景                                     | 怎么组合                  | 详细说明                                                         |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| 编码设置后再读回原值                     | `createSerializeRegistry` | [完整示例](./USEGUIDE.md#编码设置后再读回原值)                   |
| 默认写新格式，按已保存标签读旧格式       | `createSerializeRegistry` | [完整示例](./USEGUIDE.md#默认写新格式按已保存标签读旧格式)       |
| 拒绝非有限计数，避免悄悄存成 null        | `defineJsonCodec`         | [完整示例](./USEGUIDE.md#拒绝非有限计数避免悄悄存成-null)        |
| 把同一份配置导出为三种文本格式           | `emitOutput`              | [完整示例](./USEGUIDE.md#把同一份配置导出为三种文本格式)         |
| 拒绝访问器字段，不执行其读取代码         | `emitOutput`              | [完整示例](./USEGUIDE.md#拒绝访问器字段不执行其读取代码)         |
| 逐片处理数组，不把多个 JSON 文档直接拼接 | `encodeStream`            | [完整示例](./USEGUIDE.md#逐片处理数组不把多个-json-文档直接拼接) |

## 安装

```bash
pnpm add @migaia/serialize
```

运行时依赖 @migaia/lifecycle 和 @migaia/utils；MessagePack、CBOR、Protobuf 的可选 peer 安装见契约细节。

运行后面的 encodeStream 场景还需在消费项目直接安装 @migaia/utils，因为示例显式导入它的 scheduler 子入口。

```bash
pnpm add @migaia/utils
```

## 常用 API

| API                                  | 什么时候用                   |
| ------------------------------------ | ---------------------------- |
| createSerializeRegistry / jsonPlugin | 创建格式选择与清理 owner     |
| registry.encode / registry.decode    | 默认写入，按 type 读取       |
| defineJsonCodec                      | 使用版本化严格 portable JSON |
| emitOutput                           | 生成完整 JSON/YAML/TOML 文本 |
| encodeStream / decodeStream          | 按独立数组片逐步处理         |
| registry.close / registry.dispose    | 停止新请求并等待资源清理     |

## 契约细节

### 入口与依赖边界

本包负责值、分段协议、格式与编解码生命周期，不实现存储、Worker、HTTP 或 SSR 宿主。根入口聚合 core、plugins、registry，并提供格式常量、emitOutput、createPortableWalker 及 codec 相关类型。常见协议入口如下。

| 入口                                 | 提供的能力                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| @migaia/serialize/core               | chunk/parser/context/registry 契约、SerializeCodecError、错误工具、Base64、流式工具与相关类型。       |
| @migaia/serialize/plugins            | jsonParser、jsonPlugin、IJsonPluginOptions。                                                          |
| @migaia/serialize/registry           | createSerializeRegistry、chunkToText、chunkToBytes 与 registry/context/parser/Encoding/cleanup 类型。 |
| @migaia/serialize/codec              | ICodec、ICodecValue、CodecErrorText、portable 工厂与默认 helper、normalizeCodecFailure。              |
| @migaia/serialize/codecs/identity/v1 | 唯一公开 identityCodec 入口；保持运行时对象与具体 TypeScript 类型。                                   |
| @migaia/serialize/codecs/json        | defineJsonCodec 与 IJsonCodecOptions，不加载二进制格式运行时。                                        |

core 静态复用 @migaia/lifecycle/abort 作为唯一取消 owner，打包消费者保留必要 abort 闭包，其他 lifecycle root、scope、scheduler、generation、quiescence、disposal 可被移除。core 的 timer 与 Encoding 能力由调用方注入，不导出 registry 实现、chunk 转换 helper、JSON 插件或根入口格式常量。registry 复用 lifecycle 的 scheduler/abort/scope/quiescence；字节算法与错误身份来自 @migaia/utils。依赖方向不反向指向 Store、RPC 或 UI。

IAbortSignal 从 @migaia/utils/promise 导入，本包不重复导出。它是含 aborted、reason?、addEventListener、removeEventListener 的结构契约，不依赖 DOM 类型；原生 AbortSignal 可直接传入。仅用根入口、codec 或 JSON codec 不需要以下可选 peer。

### @migaia/serialize/codecs/protobuf

该子入口提供 defineProtobufCodec、IProtobufCodecOptions 与 IProtobufSchema，需要可选 peer @bufbuild/protobuf，支持范围 ^2.14.0。

```bash
pnpm add @bufbuild/protobuf
```

缺少该 peer 时，Node 导入此子入口抛 ERR_MODULE_NOT_FOUND，消息包含 @bufbuild/protobuf；其他入口仍可加载。

### @migaia/serialize/codecs/message-pack

该子入口提供 defineMessagePackCodec 与 IMessagePackCodecOptions，需要可选 peer @msgpack/msgpack，支持范围 ^3.1.3。

```bash
pnpm add @msgpack/msgpack
```

缺少该 peer 时，Node 导入此子入口抛 ERR_MODULE_NOT_FOUND，消息包含 @msgpack/msgpack；其他入口仍可加载。

### @migaia/serialize/codecs/cbor

该子入口提供 defineCBORCodec 与 ICborCodecOptions，需要可选 peer cbor-x，支持范围 ^1.6.6。

```bash
pnpm add cbor-x
```

缺少该 peer 时，Node 导入此子入口抛 ERR_MODULE_NOT_FOUND，消息包含 cbor-x；其他入口仍可加载。

### Chunk、parser 与格式常量

ISerializeChunk 是只读二元组：text 携带 string，bytes 携带 Uint8Array，value 携带已经完成的 unknown 业务对象。text/bytes 是可传输的文本/字节；value 没有隐含文本或字节形式。ISerializeChunkKind 为三个标签的联合类型。

ISerializeParser 要求 name、encode(value, context)、decode(chunk, context)，可选 dispose()。encode 可返回单段、Promise 单段、同步 Iterable 或 AsyncIterable；decode 返回值或 Promise。上述四种编码结果的联合类型是 ISerializeOutput。同步 parser 直接返回值即可，无需自己制造 Promise。ISerializeContext 含组合 signal 和定位字符串 context；名称不是旧 source，避免与错误来源混淆。ISerializePlugin 是 { type, parser }，把格式标签与实现绑定。

registry.encode 将一次 parser 输出收集为一个 chunk：全 text 拼文本；出现 bytes 就用 encoder 将 text 转为字节再合并；value 必须独占，混入任何其他段均为 INVALID_CHUNK；零段为 ENCODE_FAILED。逐段接纳会记录真实 chunkIndex 与 bytesConsumed；每次消费前检查取消。异步迭代失败会调用 iterator.return 清理，次要清理错误交 report，不覆盖主错误。

isChunkShape 仅区分单段与段容器：必须是长度为 2 的数组，首项是字符串。它不检查标签是否合法，后续校验才区分 unknown tag、text 数据非字符串、bytes 数据非真正 Uint8Array 等错误。公开边界取得的 tuple 字段需要作为一次快照使用，不应靠后续反复读取来重解释输入。

根入口常量与值联合复用规范值：SerializeChunkKind/ISerializeChunkKind 为 text/bytes/value；SerializeOutput/ISerializeOutputFormat 为 text/structured/binary；SerializeTextFormat/ISerializeTextFormat 为 json/yaml/toml；SerializePhase/ISerializePhase 为 encode/decode；SerializeCleanupPolicy/ISerializeCleanupPolicy 为 throw/report；SerializeCleanupKind/ISerializeCleanupKind 为 cleanup-error/drain-timeout；SerializePluginType/ISerializePluginType 为 json。这些标签不发出 instrumentation 事件，也不是新增错误码。

### Registry 创建与准入

createSerializeRegistry(plugins, options?) 要求非空插件数组，第一项 type 为 primaryType。每个 type 必须是长度 1–64 的 ASCII token，首位字母/数字，其余可含点、下划线、连字符；SERIALIZE_TYPE_PATTERN 为 /^[a-z0-9][a-z0-9._-]{0,63}$/i，assertSerializeType 非法时抛 RangeError/INVALID_OPTION。写入 HTML 或存档信封时仍需正确转义，token 校验不能代替输出转义。

插件 type 不能重复；parser 必须有可调用 encode/decode，dispose 提供时也必须可调用。空表、重复 type 是 RangeError/INVALID_OPTION，结构非法是 TypeError/INVALID_OPTION。插件列表、字段和方法在接管前完成准入快照，原对象后续改写不能替换已接纳的行为；准入失败不调用 parser 或其 dispose，也没有半接管后回滚的义务。options 省略为空对象，提供时必须为对象或函数。

| registry options | 默认与语义                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| scheduler        | @migaia/utils/scheduler 的 systemScheduler，创建后固定；要求 now/schedule 可调用，now 返回有限数字。                                 |
| encoder          | 宿主 TextEncoder；提供时必须有 encode(string): Uint8Array，缺省且宿主缺失为 ENV_UNSUPPORTED。                                        |
| decoder          | 宿主 TextDecoder；提供时必须有 decode(Uint8Array): string，缺省且宿主缺失为 ENV_UNSUPPORTED；此处只捕获校验，不自动配置 jsonParser。 |
| cleanup          | { policy: 'throw' }；另一值为 { policy: 'report', report }，report 必须可调用。                                                      |
| onDrainTimeout   | no-op；截止已过，或到期仍有在途工作时通知，pendingCount 可为 0。                                                                     |
| report           | no-op；已公开结算后才到达的失败，以及次要 iterator 清理失败的观察口。                                                                |

options getter、scheduler、Encoding 能力的读取和调用按准入边界保留原始 cause；不能让裸访问器失败替代本包错误身份。scheduler.schedule(callback, delayMs) 返回有 cancel()、可选 unref() 的任务；core 使用 timer 时不直接读取全局计时器。

### Registry 操作与关闭

primaryType 是第一项格式；types 是登记顺序的只读名字列表；has(type) 查询是否登记。encode(value, options?) 和 decode(chunk, options?) 返回 Promise。操作 options.type 默认 primaryType，context 默认 anonymous，signal 默认未提供；传给 parser 的 context.signal 包含调用方与内部 closing 信号，谁先被观察为取消就采用谁。未知格式为 CODEC_NOT_FOUND，错误 context 固定 registry。ISerializeRegistry 与 ISerializeRegistryOptions 分别表示返回接口和构造选项。

decode 的准入先看是否关闭，再找格式，最后校验 chunk，因此分别优先产生 REGISTRY_DISPOSED、CODEC_NOT_FOUND、INVALID_CHUNK。关闭后的调用失败是带码原生 Error，不必是 SerializeCodecError。即使 parser 忽略 signal，框架也会在取消时提前拒绝并丢弃晚到结果，不代表底层同步计算或外部任务被强制终止。

close() 同步且幂等：拒绝新请求并取消当前操作，但不释放 parser。dispose(options?) 先 close，再排空，随后逐个 await parser.dispose；共享一个 parser 的多个 type 只释放一次。重复 dispose 返回第一次的同一 Promise。

dispose 的唯一可选字段 deadlineAt 默认 undefined，提供时必须是 scheduler.now 时间域的有限绝对时间。首次接纳调用固定截止值；后续调用不能修改。截止只限制 drain，不是 parser cleanup 的硬超时。截止已过或等待期间到期时可触发 { kind: 'drain-timeout', source, deadlineAt, pendingCount }，随后继续释放。pendingCount 可以为 0；onDrainTimeout 是诊断，不是新的错误码。ISerializeTimeoutDiagnostic 描述该事件；ISerializeCleanupError 描述清理失败事件。

取消 listener 登记后会立即重查信号，不依赖宿主重放事件；进入操作时已经关闭的内部信号优先。取消原因保持 cause 身份，读取信号失败为 INVALID_OPTION。公开 Promise 可及时取消，底层 parser task 仍由 registry 跟踪；close 本身不等待它。

cleanup.policy 为 throw 时，清理失败成为 dispose 的拒绝；已有 primary 时，次要失败追加到 errors，必要时通过 AggregateError 保留全部原因。report 策略发出 { kind: 'cleanup-error', source, error } 并保持正常结算。report/onDrainTimeout 自身异常被限制在诊断路径，不能改写已公开结果；report 自身失败交 utils 宿主异常通路。底层 detached task 的迟到失败也要观察，不重新加入已关闭的生命周期；未配置 report 保持既有 no-op。

### JSON 插件与字节转换

jsonParser(options?) 返回 name=json 的 ISerializeParser；jsonPlugin(options?) 返回 type=json 的插件。IJsonPluginOptions 的 replacer、reviver、space 默认未提供，分别交 JSON.stringify、JSON.parse 和缩进；decoder 默认在字节解码时使用宿主 TextDecoder。配置缺省为空对象，普通 JSON 语义并不等于 portable 严格校验。

encode 产出 text；stringify 返回 undefined 时拒绝，原生编码失败标 ENCODE_FAILED。decode 的 value 直接返回原对象；text 直接 parse；bytes 经 decoder 后 parse，缺失能力为 ENV_UNSUPPORTED，解析失败标 DECODE_FAILED。独立 parser 也有错误身份；可附码原生错误保留实例、类型和 stack，冲突或不可扩展时用 coded TypeError wrapper 的 cause 保留原错。

chunkToText(chunk, decoder) 与 chunkToBytes(chunk, encoder) 的 Encoding 参数必填。前者 text 原样返回，bytes 解码；后者 text 编码，bytes 返回 slice 副本，不共享原数组。value 均拒绝为 TypeError/INVALID_CHUNK。转换器自身抛错按 decode/encode 标注，错误原因不丢失。

### 流式切片、背压与收集

sliceByFrameBudget(items, options) 是 async generator，items 为只读数组，options 和 scheduler 必填，没有 core 全局 timer 默认值。它在 yield 后恢复时观察消费者处理该片的耗时，用 targetMs / max(elapsed, 0.05) 估计下一片大小，与当前值取中点，再限制到 minItems/maxItems；这是协作式切片，不保证任何设备上的帧率。IFrameBudgetOptions 是切片选项，IEncodeStreamOptions 增加编码选项，ICollectStreamOptions 是收集策略；自定义 yieldTo 负责自己的 Promise 与取消，不能假定其等待总能及时中断。

| 切片选项     | 默认与约束                                                          |
| ------------ | ------------------------------------------------------------------- |
| targetMs     | 8，必须有限且大于 0。                                               |
| minItems     | 64，安全整数且至少 1。                                              |
| maxItems     | 250000，安全整数且至少 minItems。                                   |
| initialItems | 2048，安全整数且至少 1；实际切片受上下界限制。                      |
| yieldTo      | 未提供时 scheduler.schedule(resolve, 0)；默认等待可被 signal 取消。 |
| signal       | 未提供；每次继续取片前检查取消。                                    |
| scheduler    | 必填，now 有限，schedule 返回可 cancel 任务。                       |

encodeStream(registry, items, options) 使用同一切片选项，另加 type（默认 registry 主格式）、context（默认 stream）、maxInFlight（默认 1，必须为正安全整数）。每片单独调用 registry.encode，按输入顺序 yield，maxInFlight 限制同时在途的编码。单个 JSON 数组片段不因相邻而成为一个完整 JSON 文档；需要还原整批时逐片 decode，再在业务层合并数组。

decodeStream(registry, chunks, options?) 接受同步或异步 chunk iterable，options 默认空对象，type 默认 registry 主格式，context 默认 stream，signal 默认未提供；逐片 decode 并 yield，不整体拼装。两种 stream 错误分别包装 ENCODE_FAILED/DECODE_FAILED，chunkIndex 是外层片序，bytesConsumed 为 0，原内层错误留在 cause。外层位置与单次 parser 的内部段号不同。

流入口先读取选项快照，再取得 iterator；失败不能被误报成迭代失败。取消在异步边界后仍需复查，源/生成器提前结束时要结束所属 iterator；次要 return 失败走报告，不覆盖主错。encodeStream 提前 break 时取消自己创建的操作并观察剩余在途任务，不等待不合作的 parser 无限挂起；parser drain 仍由 registry.dispose 管理。

collectStream(chunks, encoder?, options?) 只适合确实需要一整块结果的消费者，不能免除全量驻留。options.signal 默认未提供，empty 默认 text（空流返回 ['text', '']），另值 reject；context 默认 stream。全 text 用 join 拼接；单个 bytes 可以直接返回；多个 chunk 且含 bytes（即使全 bytes）须显式传 encoder，否则 ENV_UNSUPPORTED，core 不读取全局 TextEncoder。value 一律 INVALID_CHUNK。坏 tuple 保留 chunkIndex/累计 bytesConsumed，源迭代失败标 ENCODE_FAILED；Abort 保留取消身份，相关 iterator 清理仍受边界约束。

### Base64 与二进制文本通道

bytesToBase64(Uint8Array) 返回完整 RFC 4648 Base64；base64ToBytes(string) 要求规范填充、有效末尾未用位，失败为 TypeError/INVALID_OPTION，cause 保留 utils 原始 INVALID_ENCODING。它不同于 portable tag 使用的不填充 base64url。

streamBase64Chunks(bytes) 为同步惰性 Generator，逐块 yield 而不拼完整字符串，空输入零块。内部块长 32763 字节，是 3 的倍数，避免片间填充破坏编码；没有公开块长选项。算法来自 utils/bytes，不构造整份 binary string，也不调用 btoa/atob。最终必须得到单一字符串时用 bytesToBase64；能直接传字节的通道无需先转 Base64。4/3 的体积变化是编码格式的性质，不是性能测量。

### 版本化 codec

`ICodec<TValue, TEncoded, TId, TVersion>` 含只读 id、version、encodedType、encode、decode；后两项是函数属性，保留严格参数方差。TId 默认 string、TVersion 默认 number。encodedType 只能 unknown/string/uint8array，codec 的同步函数不等于 registry 的异步 parser。identityCodec 固定 id=identity、version=1、encodedType=unknown，encode/decode 原样返回同一值及具体类型；旧 alias 和无版本 identity 子入口已删除。

defineJsonCodec、defineMessagePackCodec、defineCBORCodec 的 options.version 必填，为正安全整数；工厂返回冻结 codec，id 分别为 json、message-pack、cbor，输出分别为 string、Uint8Array、Uint8Array。三者先做同一 portable 投影/校验；JSON、集合 JSON、CBOR 与 MessagePack 按 Object.keys 属性枚举顺序投影，不做比较排序，getter 每次按该顺序读取；MessagePack 不使用扩展；CBOR 关闭 records 和宿主扩展，解码 bigint 整数仅在可精确表示为安全整数时转 number，否则拒绝。

defineProtobufCodec 的 options 必含 version、schema、binding。schema.id 符合 /^[a-z][a-z0-9.-]*$/u，schema.version 为正安全整数，与 codec.version 独立；binding 必须为生成的 Buf DescMessage，不能传自定义 encode/decode hook。返回冻结 schema 身份，业务值为 `MessageShape<TBinding>`；encodedType=uint8array，encode/decode 验证真实 Uint8Array，并保留 Buf 原错误原因。格式工厂自身不提供存储或网络信封。

ICodecValue 的静态域为 null、boolean、number、string、嵌套只读数组和记录；数值仍需运行时有限性检查。normalizeCodecFailure(error, code, message) 原样保留本包已标注 Error，其他失败包装为 TypeError 并保留 cause；CodecErrorText 持有稳定版本、schema、编解码和 portable 拒绝文案。

### Portable 默认规则与可复用 walker

toPortableValue(value, active?) 返回旧中间投影，不等于最终断言：普通对象按 Object.keys 属性枚举顺序逐项读取并递归，得到可变 ordinary 对象，不冻结；Uint8Array 变成 { $rpc: 'bytes', base64url }。继承/非枚举/symbol 字段不进入记录投影，getter 可能执行，重复兄弟引用各复制一次；环只按当前祖先路径判断。投影阶段可暂存 undefined/NaN 等中间值，格式 codec 最终校验才拒绝。

assertPortableValue(value, active?) 返回 void，asCodecValue(value) 验证后返回同一 ICodecValue 视图；不复制或冻结。默认 decoded profile 拒绝非有限数、undefined、函数、symbol、bigint、Date/Map/Set、非法数组和 native bytes；认可的 bytes tag 保留既有字符集规则，不冒称额外协议的 canonical 位校验。默认深度不限。ArrayBuffer/class 等旧投影行为不应被误称为通用安全快照。

createPortableWalker(strategy) 从根或 codec 导入，在模块/owner 作用域创建一次并复用。每次 walk(value, active?, initialDepth?, beforeNativeBinary?) 返回 { value, byteUpperBound, hasBinary }；walk.value 用同一递归，只返回值。active 为当前祖先 Set，缺省按本次需要建立并在结束后释放图引用；initialDepth 默认 0，根深度 0，大于 maxDepth 才拒绝。binary guard 是本次调用的可选边界，不是全局注册。

| 策略 hook                                                                    | 职责                                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| scalar(value, context)                                                       | 必填；返回 primitive 或 { value, violation? }，保留延迟失败优先级。                                                           |
| binary(value, context)                                                       | 必填；返回 inline base64url string、借用 Uint8Array/ArrayBuffer，或 undefined 继续容器准入。                                  |
| nativeByteLength(value)                                                      | native 结果必需的 intrinsic 长度读取器，不能信任 caller shadow getter。                                                       |
| record(value, context)                                                       | 必填；返回 { entries, output?, tag?, hasBinary?, validate? } 或 undefined；entries 可预捕获或惰性读取，未给 output 时仅校验。 |
| array(value, visit, context)                                                 | 可选；返回原数组或 { value, length?, violation? }，默认沿 map，捕获 length 可免重读。                                         |
| arrayValue(value, ownedVisit, childDepth, ancestors, guard, bounds, context) | 与 array 互斥，直接返回原投影，用 visit 保持词法遍历归属，不能自己另写递归。                                                  |
| maxDepth                                                                     | 默认无限制，由策略决定预算。                                                                                                  |
| key(key, context)                                                            | 可选，在访问子值前校验保留字段。                                                                                              |
| write(output, key, child)                                                    | 可选；默认 defineProperty，确保 own `__proto__` 不改原型。                                                                    |
| finish(value, hasNativeBinary)                                               | 可选，可冻结容器；native leaf 不复制、不冻结、不调用 finish。                                                                 |
| violation(reason, cause?)                                                    | 必填，抛调用方已拥有的 coded 原生错误，保留原始 cause 和 stack。                                                              |

context 提供 reject、isAncestor、isUint8Array、bytesToBase64url、isCanonicalBase64url 及可选 beforeNativeBinary。通用原因有 depth/cycle/access/ancestor，其余由策略拥有。context 只供同步 hook 使用；已分类错误保持身份，应用回调异常交 violation('access', original)，祖先 Set 自身失败保持原边界。

byteUpperBound 是 JSON UTF-8 保守上界，不是实际长度：每 UTF-16 单元最多 6 个转义字节、数值最多 32 字节，加容器标点与 bytes tag。值、字节上界和 hasBinary 同次遍历融合，不再扫描输入；native 长度由策略给出，不能把这个数当完整共享 backing/offset 协议预算。

IPortableBinaryResult 是 string/Uint8Array/ArrayBuffer 的非包装联合。native 对象保留 exact identity，不复制或冻结；finish 的第二参数仅证明 native descendant，hasBinary 还包含 inline tags，不能据此授予某协议 native 权限。重入 getter 会恢复外层会计与活动路径，已完成调用不保留输入；value-only 数组路径不额外探测输出 length。

默认 JSON/MessagePack/CBOR 仍为 inline-only，保留原字节与失败优先级：先完成投影，再抛延迟校验错误，较晚 getter 失败仍可优先。RPC 的 null-prototype/freeze、父字段预捕获、深度 64、canonical tag 与协议身份由 rpc-contract 自己的策略拥有，serialize 不内置消费者 profile，也不拥有 manifest 或 native 协商。

### 安全的文本输出

emitOutput(value, format?) 同步返回完整文本，format 默认 json，另有 yaml/toml；JSON 复用 jsonParser，YAML/TOML 仅输出、不引入第三方运行时，也不是 registry parser。

输入只接受有限数、字符串、布尔、数组和 plain own-data 记录，JSON/YAML 允许 null。描述符准入拒绝可枚举访问器而不求值，也拒绝循环、稀疏数组、命名数组属性、可枚举 symbol、不支持的值与非普通原型。不会调用 toJSON、replacer 或业务 getter，失败不返回部分文本，诊断不回显输入。

TOML 只接受对象根，任意深度 null 和未配对 surrogate 都拒绝；键和字符串加引号，嵌套集合保持结构。负零输出 -0.0，不安全整数用浮点写法避免进入 TOML 整数域。错误为带 source/code 的原生 TypeError/INVALID_OPTION，读取失败保留原因。这个严格 own-data 输出规则与旧 portable 投影不同。

### 错误身份、定位与排查

SerializeCodecError(message, details) 的 details 必含 code、type、phase、chunkIndex、bytesConsumed，可选 context、source、cause；source 默认 serialization，TCode 默认 ISerializeErrorCode，上层可用自己的 code 联合与 source 复用它。phase 为 encode/decode，cause 保留原对象。registry 编解码失败和原生构造/生命周期失败载体不同，统一按 (source, code) 判断，不能只靠 instanceof。

| SerializeErrorCode 成员 | 码值与边界                                                                       |
| ----------------------- | -------------------------------------------------------------------------------- |
| registryDisposed        | REGISTRY_DISPOSED：close/dispose 后新操作，tagged Error。                        |
| codecNotFound           | CODEC_NOT_FOUND：请求格式未注册，SerializeCodecError，context=registry。         |
| encodeFailed            | ENCODE_FAILED：编码、空输出或流迭代失败；cause 保留原错。                        |
| decodeFailed            | DECODE_FAILED：解析或逐片解码失败。                                              |
| invalidChunk            | INVALID_CHUNK：tuple/标签/数据错、value 混流或转 wire。                          |
| aborted                 | ABORTED：协作式取消；可能为 SerializeCodecError 或 tagged 原生错误，取决于边界。 |
| invalidOption           | INVALID_OPTION：插件、版本、portable、scheduler、流选项、Base64 或输出准入非法。 |
| envUnsupported          | ENV_UNSUPPORTED：Encoding 等必需宿主能力缺失。                                   |
| tagMissing              | TAG_MISSING：无标签输入缺少显式 untagged 读取器。                                |
| tagInvalid              | TAG_INVALID：保留头部损坏，不回退。                                              |
| tagUnknown              | TAG_UNKNOWN：合法标签没有对应的登记版本。                                        |

tagSerializeError(error, code, context?) 返回原错误并附只读 source/code，context 未提供保持未设；同身份重复附加幂等，context 仅补一次。冲突委托 utils，抛 (foundation.utils, ERROR_IDENTITY_CONFLICT)，原错误在 cause，不能静默改写身份。

ISerializeTaggedError 为原生错误附 source/code/context 的类型；ISerializeTypeError、ISerializeRangeError 保持各自原生类型，ISerializeLifecycleError 另允许 errors。createSerializeError、createSerializeTypeError、createSerializeRangeError 分别构造带码 Error/TypeError/RangeError；code/message 必填，options 默认未提供，均允许 cause/context，普通 Error 另允许 errors 的冻结快照。错误码是公开 API，错误 factory 不改写 stack。空输出进度为 0；decode 坏 chunk 进度为 0；decode parser 原错携带该段字节数；外层 stream 重新包装保留自己的片序，不丢掉内层原因。

value 不能转文本/字节或混用时应回到业务对象处理；CODEC_NOT_FOUND 先检查 types 与存档的 type；REGISTRY_DISPOSED 需要新 registry；collectStream 合并含 bytes 的多段须显式 encoder。大数据仍阻塞时检查初始片大小、上下限与 yieldTo，不能把切片当作抢占式终止。

完整组合顺序为：创建 registry；逐片 encode 并交实际 sink；接收端逐片 decode；旧格式用记录的 type 读取，新写默认 primaryType；需要文本边界时再显式做 UTF-8/Base64；最后 await dispose，若设 deadline，记住它只限排空。包提供 fmt、lint、typecheck、typecheck:test、test 与单独 build，不把未复核历史测量当作性能结论。

### 在 JSON 中保留 Map 与 Set

值含 Map 或 Set 时显式选集合 codec。它复用严格 JSON 的 portable 规则，增加递归集合，投影类实例的可枚举字段，拒绝非有限数字、undefined、Date 与循环引用。保留的 $rpc 记录须符合 bytes/map/set 的精确形状。集合按插入顺序遍历，使用内部槽及内建迭代器。字节解码后仍为 bytes 记录；旧集合元组按普通数据读取。

```ts
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'

const codec = defineCollectionsJsonCodec({ version: 1 })
const source = new Map([['roles', new Set(['read', 'write'])]])
const text = codec.encode(source)
console.log(text) // {"$rpc":"map","entries":[["roles",{"$rpc":"set","values":["read","write"]}]]}
console.log(codec.decode(text)) // Map { 'roles' => Set { 'read', 'write' } }
```

格式 codec 与公开 toPortableValue 都先枚举整数索引，再按字符串插入顺序输出，getter 遍历顺序相同。serialize 不负责键排序；需要规范顺序时，由消费者负责规范化。RPC owned 快照与普通对象、字节 JSON 路径均保持对象自身的 key 顺序；RPC 私有快照仍由原单遍遍历同时完成复制与字节上限计算，并跳过已经编码的二进制子树。

### 编码结果自带格式标签

首项 codec 写新值，列表内各 id/version 读取自己的带标签载荷。可选 untagged 只读取原始旧数据。未知标签报 TAG_UNKNOWN；保留头部损坏报 TAG_INVALID，不回退。无标签文本若以 mgt1: 开头，也会当作有标签输入，即使它来自 untagged codec。

```ts
import { createTaggedCodec } from '@migaia/serialize/tagged'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const current = defineJsonCodec({ version: 2 })
const previous = defineJsonCodec({ version: 1 })
const tagged = createTaggedCodec({ codecs: [current, previous], untagged: previous })
console.log(tagged.encode({ count: 2 })) // mgt1:json@2;{"count":2}
console.log(tagged.decode('mgt1:json@1;{"count":1}')) // { count: 1 }
console.log(tagged.decode('{"count":1}')) // { count: 1 }
try {
  tagged.decode('mgt1:json@3;{"count":3}')
} catch (error) {
  console.log((error as Error & { code: string }).code) // TAG_UNKNOWN
}
```

字符串载体前置 mgt1:<id>@<version>;。字节载体前置 00 4d 47 54、格式字节 01、两字节大端 UTF-8 标签长度与标签。unknown 载体返回带自有 $migaia.codec 和 value 的冻结对象，内层值不冻结。所有 codec 声明同一载体，外层身份为 tagged@1，与存储 envelope 版本独立。ICodecEncodedType、ITaggedCodecOptions、ITaggedEncoded、ITaggedValue 与 ITaggedCodec 保留载体及业务值推断。
