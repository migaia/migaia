# `@migaia/store-wasm` 使用指南

每个示例单独加载真实发布的 WASM，并使用 createStore 提供的字段 owner。先按场景查找，再看完整的容量、通知、释放与原生错误边界。

## 按场景查找

| 场景                                 | API          | 详细说明                                          |
| ------------------------------------ | ------------ | ------------------------------------------------- |
| 创建字段前复用同一个就绪 Promise     | `ensureWasm` | [完整示例](#创建字段前复用同一个就绪-promise)     |
| 原生内存增长后继续读写数值字段       | `number`     | [完整示例](#原生内存增长后继续读写数值字段)       |
| 按 UTF-8 容量拒绝超长写入并保留原值  | `string`     | [完整示例](#按-utf-8-容量拒绝超长写入并保留原值)  |
| 独立追踪数组下标并隔离拷贝视图       | `array`      | [完整示例](#独立追踪数组下标并隔离拷贝视图)       |
| 范围输入无法读取时保持数组原值       | `array`      | [完整示例](#范围输入无法读取时保持数组原值)       |
| 只观察一个坐标字段而不订阅其同级字段 | `record`     | [完整示例](#只观察一个坐标字段而不订阅其同级字段) |

## 运行准备

```bash
pnpm add @migaia/store-wasm @migaia/store-light @migaia/wasm @migaia/reactive
```

示例是 Node 独立 TypeScript 文件，直接导入列出的包。readFile 读取相对于 @migaia/wasm 主入口的 sibling wasm_provider_bg.wasm，initWasm 的 module_or_path 传这份字节；省略会走默认资源 URL，Node 的 file URL fetch 不适合该默认路径，Promise 输入也可由底层 loader 接收。ensureWasm 自身无参数。所有创建的 Store/观察者显式释放，不使用假的 WASM 或字段 context。

## 创建字段前复用同一个就绪 Promise

多个启动入口都要创建 WASM 字段，可能同时询问模块是否已经就绪。

每次查询都临时包装初始化 Promise，会让调用方拿到不同的就绪凭据，即使模块早已加载成功。

Node 中先从发布的文件初始化原生模块，再调用无参数的 `ensureWasm()`；等待中及成功后，它都会复用同一个 Promise。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm } from '@migaia/store-wasm'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
const first = ensureWasm()
const second = ensureWasm()
console.log(first === second)
const memory = await first
console.log(memory instanceof WebAssembly.Memory)
console.log(first === ensureWasm())
```

输出：

```text
true
true
true
```

输出三行 `true`：两次等待中的调用相同，结果是原生内存，成功后的调用仍返回原 Promise。

它只建立就绪条件，不分配字段，也不移交共享内存的所有权；初始化失败会清空尝试缓存，同步创建字段仍须等待一次成功的调用。

### 示例参数

ensureWasm 无参数、不分配字段，返回共享 `Promise<WebAssembly.Memory>`；相同 Promise 包括 pending 与成功后。url 是发布文件相对包入口的位置，initWasm.module_or_path 为 readFile 返回的 Uint8Array 字节。WebAssembly.Memory 检查确认真实内存对象，不移交其整个生命周期。

## 原生内存增长后继续读写数值字段

其他 WASM 分配可能在数值字段仍被使用时增长线性内存。

如果手写读写逻辑一直保存旧缓冲区上的 DataView，内存增长后视图会失效，原本正常的字段也就无法继续访问。

就绪后把无参数的 `number()` 交给 `createStore`；字段会读取当前内存视图，清理由 Store 统一负责。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
const memory = await ensureWasm()
const store = createStore({ score: number() })
const field = store.score
try {
  console.log(field.value)
  field.value = 12.5
  const before = memory.buffer
  memory.grow(1)
  console.log(memory.buffer !== before, field.value)
  field.value = 19
  console.log(field.value)
} finally {
  await store.$dispose()
}
console.log(field.disposed)
try {
  console.log(field.value)
} catch (error) {
  console.log((error as { code?: string }).code)
}
```

输出：

```text
0
true 12.5
19
true
FIELD_DISPOSED
```

依次输出 `0`、`true 12.5`、`19`、`true`、`FIELD_DISPOSED`：缓冲区已更换，原值仍在，新值可写，Store 释放后保留的字段引用也已关闭。

数值初始值为 `0`，按 f64 存储。这里证明正常内存增长后的读写，不代表能从原生陷阱恢复；共享实例中毒后需要重启其拥有者。

### 示例参数

number 无参数，初值 0，字段通过 .value 读写 f64。createStore 的 score 是 builder 声明，字段由 Store 拥有。memory.grow(1) 增长一个 WASM 页；字段使用新 buffer，但原分配偏移保持。最后保留字段引用检查 disposed 与访问错误，$dispose 是 Store 的释放入口。

## 按 UTF-8 容量拒绝超长写入并保留原值

标签没有超过字符数限制，编码后却放不进 WASM 字段预留的字节空间。

只数字符会低估多字节文本的容量，直接截取编码字节又可能切断一个字符，悄悄破坏原本有效的内容。

用 `string(6)` 把默认 `256` 字节改为六字节容量；超容量赋值会在提交新值之前失败。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, string } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const store = createStore({ title: string(6) })
try {
  store.title.value = '你好'
  console.log(store.title.value, new TextEncoder().encode(store.title.value).length)
  try {
    store.title.value = '你好呀'
  } catch (error) {
    console.log((error as { code?: string }).code)
  }
  console.log(store.title.value)
} finally {
  await store.$dispose()
}
```

输出：

```text
你好 6
INVALID_OPTION
你好
```

输出依次为 `你好 6`、`INVALID_OPTION`、`你好`：两个汉字占六字节，更长的赋值失败后仍读到旧值。

容量按 `TextEncoder` 编码后的 UTF-8 字节数计算且不会自动增长；超容量既不截断也不扩容，业务允许更长内容时应选更大的容量。

### 示例参数

string 的 maxBytes 默认 256，本例覆盖为 6；容量必须为范围内安全整数。value 赋值按 TextEncoder UTF-8 字节计，而非字符数。readFile/initWasm 初始化同运行准备，Store 关闭会释放该字段；超容量不改变它的旧内容。

## 独立追踪数组下标并隔离拷贝视图

界面只读取一个采样点，数组其他位置的变化却不断让这个读取者重新运行。

多个下标共用一个通知桶时，同桶的无关读取者也会失效；若直接暴露可写原生内存，又会绕过响应式写入。

用 `array(3, 1)` 把默认每桶 `64` 个下标改为逐下标追踪；通过 `setAt` 写入，`view()` 只用于取得独立拷贝。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, array } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
import { createRuntime } from '@migaia/reactive'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const runtime = createRuntime()
const store = createStore({ samples: array(3, 1) }, { runtime })
const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(store.samples.at(0))
})
try {
  store.samples.setAt(1, 7)
  runtime.flush()
  console.log(seen.join(','))
  store.samples.setAt(0, 5)
  runtime.flush()
  console.log(seen.join(','))
  const copy = store.samples.view()
  copy[0] = 99
  console.log(copy[0], store.samples.at(0))
} finally {
  effect.dispose()
  await store.$dispose()
}
```

输出：

```text
0
0,5
99 5
```

输出为 `0`、`0,5`、`99 5`：改下标 `1` 不重跑只读下标 `0` 的观察者，改下标 `0` 才重跑；把副本改成 `99`，字段仍为 `5`。

下标须为 `[0, length)` 内的安全整数，不支持 `Array.at` 的负数索引。`view()` 不追踪读取，也不回写；更粗的桶会使邻近下标的读取者一起失效。

### 示例参数

array 的 length 必填，本例 3；granularity 默认 64，本例设为 1。createStore options.runtime 显式使用创建的 Runtime。effect 的回调首次执行计入 seen，runtime.flush 明确完成调度；setAt 需有效非负安全整数下标与 number 值，view 无参数且不追踪。

## 范围输入无法读取时保持数组原值

批量更新从类数组对象读取数值，其中某个访问器可能在读取到一半时抛错。

边读边写会把前面的新值留在字段里，后面的访问器一失败，数组就停在只更新了一部分的状态。

`setRange` 会在写入左闭右开区间 `[lo, hi)` 前读完全部输入；读取失败时附加错误身份，现有字段字节保持不变。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, array } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const store = createStore({ samples: array(3) })
const failureText = '无法读取范围输入'
const failure = new TypeError(failureText)
const input: ArrayLike<number> = {
  length: 3,
  0: 9,
  get 1(): number {
    throw failure
  },
  2: 9
}
try {
  store.samples.setRange(0, 3, [1, 2, 3])
  try {
    store.samples.setRange(0, 3, input)
  } catch (error) {
    console.log(error === failure, (error as { code?: string }).code)
  }
  console.log([...store.samples.view()].join(','))
  store.samples.setRange(0, 2, [4, 5])
  console.log([...store.samples.view()].join(','))
} finally {
  await store.$dispose()
}
```

输出：

```text
true INVALID_OPTION
1,2,3
4,5,3
```

输出为 `true INVALID_OPTION`、`1,2,3`、`4,5,3`：原 TypeError 身份保留，失败输入没有改动字段，随后仍可正常写入有效范围。

`values.length` 必须等于 `hi - lo`，所有输入值都须为数字。这里证明先读后写，不承诺撤销访问器自身的外部副作用，也不泛化为通知回滚。

### 示例参数

array(3) 使用默认 granularity=64。setRange 的 lo/hi 为左闭右开范围，values.length 必须等于 hi-lo，元素均为 number；input 本例是有一个抛错 getter 的真实 ArrayLike。先写入 [1,2,3] 后再拒绝 input，原 TypeError 保持身份和 INVALID_OPTION，之后 [0,2) 可写入 [4,5]。

## 只观察一个坐标字段而不订阅其同级字段

组件只读取横坐标，纵坐标变化时却也跟着重新计算。

如果把整个位置对象当作一个依赖，任何属性变化都会让读取者重跑，即使它真正使用的输入并未改变。

用 `number()` 描述固定记录的字段；每个命名数字属性都有独立响应源，直接读写 `position.x`，无需再经过 `.value`。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import { ensureWasm, record, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
import { createRuntime } from '@migaia/reactive'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await ensureWasm()
const runtime = createRuntime()
const store = createStore({ position: record({ x: number(), y: number() }) }, { runtime })
const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(store.position.x)
})
try {
  store.position.y = 9
  runtime.flush()
  console.log(seen.join(','))
  store.position.x = 3
  runtime.flush()
  console.log(seen.join(','))
  console.log(Object.keys(store.position).join(','))
  console.log(store.position.x, store.position.y)
} finally {
  effect.dispose()
  await store.$dispose()
}
```

输出：

```text
0
0,3
x,y
3 9
```

依次输出 `0`、`0,3`、`x,y`、`3 9`：改 `y` 不影响只读 `x` 的观察者，改 `x` 才重跑，枚举时只看见业务字段。

记录值初始为 `0`；结构固定且只支持 `number()` 构造器，不支持嵌套字段和动态增键，`dispose`、`disposed` 保留给生命周期使用。

### 示例参数

record 的 shape 只支持 number() builder，本例 x/y 都从 0 开始；实际属性直接读写，不用 .value。Store options.runtime 与 effect 同一实例，flush 明确结束通知调度；Object.keys 只包含业务键，dispose/disposed 不可枚举，观察者先于 Store 释放。

## 契约细节

### 归属、入口与适用范围

本包只有根入口，导出 ensureWasm、number/boolean/string/array/record 五个 builder、八个错误码与四个错误工厂，以及 WasmReservedKey/IWasmReservedKey。字段的具体类型通过 builder 返回值公开使用，但 IWasmNumberField 等不是根入口的具名 reexport。建议 `import * as wasm from '@migaia/store-wasm'`，避免 number/string 等通用名称冲突。

依赖 reactive、store-light、wasm、utils。字段 payload 位于 WebAssembly.Memory，响应式 Source、描述符、解码后的字符串等仍使用 JS 对象；不是把整个应用状态或整个 Store 搬离 JS 堆。适合固定长度数值布局和明确容量的数据；普通小状态、类实例、函数和循环 JS 对象不需要强行使用这些字段。没有测量证据时只讨论布局与通知机制，不作速度承诺。

arena/field/number 等内部实现文件不是子路径导出。内部统一以 Wasm32 字节长度分配，并记录 memory、allocation id、ptr 与释放登记；同步分配要求已就绪，内部异步分配先等 ensureWasm。新增字段应由本包正式发布，不通过深层导入或自己复制分配器接入。

### 初始化与真实 Node 加载

`ensureWasm():Promise<WebAssembly.Memory>` 无参数，只保证底层模块内存就绪，不分配字段。模块内 pending 和成功后的 Promise 身份都稳定，返回同一个 memory；加载失败清除对应缓存，后续可重新尝试。创建 builder 本身不分配内存；Store 调用其同步 create(context) 前必须等待就绪，否则 NOT_INITIALIZED，而不是自动等待或切换到 JS 字段。

Node 的默认 file URL 不能直接交给 fetch。示例先从 `@migaia/wasm` 发布的 sibling WASM 文件读取字节，调用其默认 initWasm({module_or_path:bytes})，再 ensureWasm。module_or_path 是底层加载参数，不是 store-wasm 的字段选项；本例值为 readFile 的字节，省略会获取包内 sibling WASM URL，也可接收 Promise。文件由 node:fs/promises 读取，所有过程使用真实 WASM 实例。

浏览器等有合适 fetch 入口的宿主可直接 await ensureWasm。store-react 的 StoreProvider 可用 features.wasm:true 与稳定 ready:[ensureWasm] 阻挡子树，但不会替已在 render 外提前创建的 Store 延后分配。推荐先在应用/请求 owner 中初始化并创建 Store，再注册到对应 Runtime 的 Registry；WASM 包不反向依赖 React。外部 Registry 默认由应用释放，SSR 没有 effect 自动清理。wasm 开启却没有 ready 会生成拒绝的配置屏障，随后从 render 抛出，开发/生产都如此，不是仅开发环境的同步检查。

### Store 集成与公共协议

全部 builder 使用 store-light 的 StoreFieldMode.sync，实现 `IFieldBuilder` 的同步分支，直接放进 createStore(shape)，无需专用异步 Store 工厂。初始 WASM 加载与同步字段创建是两件事。

| 声明                       | 产出的 Store 字段                        |
| -------------------------- | ---------------------------------------- |
| number()                   | 用 field.value 读写 number               |
| boolean()                  | 用 field.value 读写 boolean              |
| string(maxBytes?)          | 用 field.value 读写 string               |
| array(length,granularity?) | 用 at/setAt/setRange/view                |
| record(shape)              | 直接 field.x 读写命名数值属性，无 .value |

Store 拥有其 builder 创建的字段，store.$dispose() 调用各字段清理；不要在仍存活 Store 中随意手动释放单字段。只有明确接管 IFieldContext 的扩展才直接 builder.create(context)：runtime、signal、createSource 属于 store-light 协议，必须使用真实 owner，自己负责返回字段的生命周期。signal 用于构造时的取消检查，不是字段运行中自动停止的开关。

真实分配器以零填充内存：number 初始 0，boolean 初始 false，string 初始空串，array 与 record 数值初始 0。字段不接受初值参数；创建后用相应写入口设置。number/boolean/string 公开只读 observed（其 Source 是否被观察）与 disposed；array 公开只读 length/disposed，record 公开只读 disposed。payload 访问在释放后拒绝，disposed 及 array.length 等元信息仍可读取。

### number 与 boolean

| builder / 布局             | 读写、比较与边界                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| number()：8 字节 f64，小端 | value:number，Object.is 相等不提交；JavaScript 传入非 number 为 TypeError/INVALID_OPTION    |
| boolean()：1 字节          | value:boolean，true/false 写为 1/0，读取非零为 true；非 boolean 为 TypeError/INVALID_OPTION |

number 接受 JS number，包括 NaN、Infinity 与负零，按 f64 储存；不是整数专用字段。读取 value 会追踪对应 Source，写入通过 Source.commit。标量写入在 commit 回调中重新取得当前 DataView，避免 owner 在提交边界增长内存后仍写入旧 buffer。无参 dispose 同步、幂等，关闭后 value 读写为 FIELD_DISPOSED。

### string(maxBytes?)

maxBytes 默认 256，必须是 0..0xffff_ffff-4 的安全整数，否则 builder 创建时 RangeError/INVALID_OPTION。分配请求为 4+maxBytes 字节，前四字节是小端 Uint32 UTF-8 长度，后面是固定容量字节区；底层分配容量可按对齐舍入，不在字符串变长时重新分配。

value 必须为 string，否则 TypeError/INVALID_OPTION。TextEncoder 编码后的字节数超过容量时 INVALID_OPTION，保留旧值、不截断；中文和 emoji 按 UTF-8 字节数而非字符数计。写前读取当前字符串做 === 比较，相同跳过提交；这一步仍需解码。getter 每次从当前 memory.buffer 按长度前缀解码，不缓存“只由本地 setter 版本决定”的字符串。存储长度超过 maxBytes 为 ALLOCATION_FAILED，表示数据损坏，不是正常截断。只读 observed/disposed 与 dispose 同标量字段。

### array(length,granularity?)

| 参数                | 默认值与约束                                          |
| ------------------- | ----------------------------------------------------- |
| length:number       | 必填，0..floor(0xffff_ffff/8)，即 536870911，安全整数 |
| granularity?:number | 64，必须是正安全整数；1 表示每个位置单独一桶          |

无效参数在 builder 创建时 RangeError/INVALID_OPTION。布局为 length*8 字节连续 f64，非空分配要求 ptr 按 8 字节对齐，否则 ALLOCATION_FAILED；空数组使用独立零长视图，不依赖分配器零字节哨兵对齐。长度固定，没有 push/splice/resize。

| 字段成员                                                      | 参数与行为                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| length:number                                                 | 只读固定长度                                                                                |
| at(index:number):number                                       | index 必须是 [0,length) 的非负安全整数；越界/非整数 RangeError/INVALID_OPTION，不支持负索引 |
| setAt(index:number,value:number):void                         | 同样索引检查，非 number 值 TypeError/INVALID_OPTION；Object.is 相等不提交                   |
| `setRange(lo:number,hi:number,values:ArrayLike<number>):void` | 半开 [lo,hi)，0≤lo≤hi≤length，端点为安全整数；values.length 必须精确为 hi-lo，每项为 number |
| view():Float64Array                                           | 无参，新建可写独立副本，不追踪、不暴露线性内存、不写回字段                                  |
| dispose():void / disposed:boolean                             | 幂等释放 / 只读关闭状态                                                                     |

连续 granularity 个位置共享一个 Source，触碰桶时按需创建；at 追踪该桶，setAt/setRange 的实际变化可让同桶其他读取者也收到通知。最多有 ceil(length/granularity) 个桶，不等于每次创建全部桶；更细的粒度增加 Source 数量，不构成已测速度结论。

setRange 先捕获 length 和全部输入项，再写任何字段字节；非法形状、长度、数值或尚未分类的 getter 失败为 INVALID_OPTION，原错误按身份或 cause 保留；已有完整外包身份的错误保留原 source/code。只把实际 Object.is 改变的值按桶分组，同批每桶一次 commit，跨桶放在一次 runtime.batch。提交失败尝试逆序恢复涉及的字段字节，但不承诺撤销 Source/通知或外部回调副作用。初始化/回滚自己的资源错误仍保持可追溯。

内部 typed view 与 DataView 按 memory.buffer 身份刷新，memory.grow 后用当前 buffer，setAt 和每桶 commit 内也重新取得当前视图。之前 view() 的快照独立，不因新增长失效；外部直接写 memory 不走 Source，因此不等于响应式写入。

### record(shape)

shape 必填，类型为 `Record<string,ReturnType<typeof number>>`。这是固定命名 f64 结构，不是可装任意 JS 值的通用对象。只支持 number builder，不支持嵌套 record/array；不要通过类型断言把 boolean/string builder 传入。运行时接纳检查对象/键和 FIELD_BUILDER 品牌，不额外证明品牌来自 number，不能把这个检查当成支持其它字段类型的契约。

Object.keys(shape) 的顺序决定 keys.length*8 字节分配里的偏移，每个键 8 字节、小端 f64。每个业务键是可枚举 getter/setter，直接 field.x 访问并独立追踪/提交；写入非 number 为 TypeError/INVALID_OPTION，Object.is 相等跳过。dispose/disposed 为不可枚举生命周期属性，Object.keys/JSON.stringify 只看到业务键。

WasmReservedKey/IWasmReservedKey 包含 dispose/disposed。record(shape) 先创建描述，保留键在字段 create(context) 阶段以 RESERVED_FIELD_NAME TypeError 拒绝，通常表现为 createStore 时失败。非法 shape、键读取或 builder 品牌读取失败为 INVALID_OPTION，原错经 cause 可达。

### 生命周期、内存与失败

创建字段时已分配的 block 与已建 Source 都由同一个 owner 管理。若 signal 已 aborted，五类 builder 使用同一原因边界：可附码原生 reason 保留类型/message/stack/身份并附 INIT_ABORTED，外包完整身份不改，不可附码原因经 cause/errors 保留。失败时尝试释放已经创建的 Sources 与 block，不把一半字段交给 Store。

正常 dispose 先把字段标为终态并注销 GC 登记，再尝试所有 Source 清理，最后释放 block；Source 失败也继续 block 清理。重复/重入 dispose 不重新清理，首次可能抛清理错误。单个清理失败保留原错；多个为 CLEANUP_FAILED AggregateError，errors 按执行顺序保留全部原对象。构造主错与回滚同时失败时，能附 secondary errors 则保留主错本身并追加非枚举 errors，否则用 [primary,cleanup] 聚合；不覆盖 primary 的 cause/stack。

FinalizationRegistry 存在时登记已创建字段，显式释放会 unregister；不支持该 API 时不报错。GC 兜底释放的时机不确定，不能替代 store.$dispose()/field.dispose()。内部 deallocation 对未知/已释放 id 无操作，分配在 WASM32 范围校验；这些 arena 原语不是根 API。

原生 WebAssembly.CompileError/LinkError/RuntimeError 保持原样穿过支持的 WASM 边界。arena export 首次 RuntimeError trap 也原样抛；arena 记录后续不可用状态，新分配以 INSTANCE_POISONED 拒绝，cause 为最初 trap，释放降为无操作以免二次 trap。不是宣称任意已有字段 getter 都会重新调用 export 或必然再 trap。共享 wasm-bindgen 实例不能在当前模块内重建，需重新加载页面或重启进程；不应重试分配并假装恢复。毒化后不承诺实际回收全部原生内存。

### 错误码、构造工厂与稳定诊断

| StoreWasmErrorCode 属性 | code                | 场景                                                     |
| ----------------------- | ------------------- | -------------------------------------------------------- |
| notInitialized          | NOT_INITIALIZED     | ensureWasm 完成前同步创建字段                            |
| fieldDisposed           | FIELD_DISPOSED      | 已释放字段的 payload 访问                                |
| initAborted             | INIT_ABORTED        | 构造时 signal 已取消，保留原 reason                      |
| reservedFieldName       | RESERVED_FIELD_NAME | record create 使用生命周期保留键                         |
| allocationFailed        | ALLOCATION_FAILED   | 无可用 allocation id/ptr、对齐失败或字符串长度损坏       |
| invalidOption           | INVALID_OPTION      | 容量、长度、粒度、下标、区间、值类型或输入读取失败       |
| cleanupFailed           | CLEANUP_FAILED      | 多项清理失败或不能直接附 secondary errors 的构造回滚失败 |
| instancePoisoned        | INSTANCE_POISONED   | arena 已 trap 后再申请分配，cause 为原 trap              |

STORE_WASM_SOURCE 为 `'@migaia/store-wasm'`，只标识本包创建的错误；已有外包身份保持原 owner。可附码 native 输入读取失败原位附 INVALID_OPTION，不可附码时用 cause/errors；不要把声明的原生 WASM pass-through 错误强制重包为普通 Error。

四个公开错误工厂 code:IStoreWasmErrorCode 与 message:string 必填。`createStoreWasmError(code,message,options?)` 返回 Error，`createStoreWasmTypeError(...)` 返回 TypeError，options 默认 undefined，仅 cause，值非 undefined 时转发；`createStoreWasmRangeError(code,message)` 无第三参；`createStoreWasmAggregateError(code,errors:readonly unknown[],message)` 保留每个原错。它们构造不自动 throw，附不可写 source/code，不改 stack。

| 稳定诊断                                                                                          | 对应边界                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `[store] WASM is not initialized; await ensureWasm() or use StoreProvider`                        | 未完成初始化                            |
| `[store] cannot use a disposed wasm field`                                                        | 关闭后 payload 访问                     |
| `[store] field init aborted`                                                                      | 无法直接保留 native reason 时的取消信息 |
| `wasm.allocate: byteLen must fit an unsigned 32-bit integer`                                      | 内部分配范围无效                        |
| `wasm.array: length exceeds the Wasm32 allocation limit`                                          | length 范围无效                         |
| `wasm.array: granularity must be a positive safe integer`                                         | 粒度无效                                |
| `wasm.array: index out of bounds (i)` / `wasm.array: invalid range [lo, hi)`                      | 索引或区间无效                          |
| `wasm.array: values must be array-like` / `wasm.array: values length must match the target range` | 输入形状或长度无效                      |
| `wasm.array: allocation not 8-byte aligned (ptr=...)`                                             | 非空数值 view 对齐失败                  |
| `wasm.string: maxBytes exceeds the Wasm32 allocation limit`                                       | 字符串容量无效                          |
| `wasm.string: value exceeds maxBytes (bytes > maxBytes)`                                          | UTF-8 容量超限                          |
| `wasm.string: corrupted byte length`                                                              | 内存中的长度前缀损坏                    |
| `wasm.<field>: value must be a <type>`                                                            | 字段值类型错误                          |
| `[store] wasm.record field name is reserved: key`                                                 | record 保留键                           |
| `[store] WASM cleanup failed`                                                                     | 聚合清理失败                            |
| `[store] WASM instance trapped earlier and is permanently unusable`                               | 已毒化的 arena                          |

### 迁移、排查与开发命令

旧 array(number(),n,g) 改为 array(n,g)，删除未使用 item 参数，编码仍固定 f64，没有兼容入口。WasmFieldMode/IWasmFieldMode 已收回，统一复用 store-light 的 StoreFieldMode.sync；类型只表达同步分支时用 typeof StoreFieldMode.sync，不能把含 async 的完整 IStoreFieldMode 联合当作等价旧别名。

未就绪时先修初始化顺序；字符串容量按 UTF-8 字节检查；想逐 index 通知用 granularity=1；view 副本改动不会提交，写入必须 setAt/setRange。固定记录不支持任意嵌套类型。构造器只声明布局，不把分配副作用放进 React render；请求/应用 owner 初始化、创建并负责释放。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
```

部分故障注入测试使用 fake WASM provider 隔离布局、释放与重入行为；api-audit 测试与本指南案例加载真实 WASM，二者都不替代 wasm 包自己的 Rust 测试。命令清单不表示本次由文档任务运行。
