/**
 * Checked against current field/arena source, README and USEGUIDE (2026-10-18). Root exports
 * builders, not concrete IWasm*Field type names or arena helpers. array(length, granularity?) is
 * fixed f64; record checks branding only, though only number builders are supported and every slot
 * is f64. ensureWasm retains the settled Promise identity; explicit disposal is the ownership
 * path.
 */
import type { ILibraryReference, IText } from './contract.js'
import { storeWasmCases } from './store-wasm-cases.js'

/** Localized source-backed contracts. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Node reads the published binary instead of fetching the default file URL. */
const nodeSetup = t(
  'Install @migaia/wasm directly for these Node 24 examples. readFile receives the URL of its published sibling binary and returns bytes. initWasm({ module_or_path }) takes those bytes here; supported inputs also include a string/Request, URL, Response, WebAssembly.Module, or a Promise of an input. Omission uses the default asset URL; Node reads it explicitly because its file URL is not fetchable. ensureWasm takes no arguments and returns the shared WebAssembly.Memory.',
  '这些 Node 24 示例还需直接安装 `@migaia/wasm`。`readFile` 接收发布入口旁二进制文件的 URL 并返回字节，交给 `initWasm({ module_or_path })`；该字段也支持字符串或 Request、URL、Response、WebAssembly.Module，以及这些输入的 Promise。省略时使用默认资源 URL，Node 不能直接 fetch 文件 URL，因此这里显式读文件。`ensureWasm()` 无参数，返回共享 WebAssembly.Memory。'
)
/** Store Light creates and owns the synchronous fields; its Runtime remains borrowed. */
const storeSetup = t(
  'Also install @migaia/store-light. createStore(initialState, options = {}) requires the field declaration; runtime defaults to Store Light defaultRuntime unless supplied. It creates the builders synchronously after readiness and owns their cleanup through await store.$dispose(). Builders themselves do not contain live field data.',
  '还需直接安装 `@migaia/store-light`。`createStore(initialState, options = {})` 的字段声明必填，`runtime` 省略时使用 Store Light 的 `defaultRuntime`；工厂在就绪后同步创建字段，`await store.$dispose()` 统一清理。构造器本身是描述对象，不保存实际字段值。'
)
/** Every field example keeps its external constructor parameters on the same API page. */
const fieldIntro = (detail: IText): IText =>
  t(nodeSetup.en + ' ' + storeSetup.en + ' ' + detail.en, nodeSetup.zh + storeSetup.zh + detail.zh)
/** Real Runtime effects are explicitly flushed so examples do not depend on scheduler timing. */
const trackingSetup = t(
  'The tracking examples also install @migaia/reactive. createRuntime() uses its default options; pass that exact runtime to createStore. effect(callback) reads synchronously, and runtime.flush() drains queued work after each write. The callback records values without returning cleanup; its returned effect is disposed before the Store.',
  '追踪示例还需直接安装 `@migaia/reactive`。`createRuntime()` 使用默认选项，并把同一运行时交给 `createStore`；`effect(callback)` 同步读取，写入后显式调用 `runtime.flush()` 处理排队工作。回调只记录值、不返回清理函数，最终先释放观察者再释放 Store。'
)
/** Full real builder-to-store path exercises all public field operations. */
const example = `import { readFile } from 'node:fs/promises'
import initWasm from '@migaia/wasm'
import * as wasm from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
import { createRuntime } from '@migaia/reactive'

const url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
await initWasm({ module_or_path: await readFile(url) })
await wasm.ensureWasm()
const runtime = createRuntime()
const store = createStore({
  score: wasm.number(), alive: wasm.boolean(), title: wasm.string(64),
  samples: wasm.array(3, 1),
  position: wasm.record({ x: wasm.number(), y: wasm.number() })
}, { runtime })
const effect = runtime.effect(() => console.log(
  store.score.value, store.alive.value, store.title.value,
  store.samples.at(0), store.position.x
))
store.score.value = 1.5
store.alive.value = true
store.title.value = 'hello'
store.samples.setAt(0, 1)
store.samples.setRange(1, 3, [2, 3])
store.position.x = 4
const copy = store.samples.view()
copy[0] = 99
console.log(store.samples.length, store.samples.at(0), store.score.observed)
const { score, alive, title, samples, position } = store
effect.dispose()
await store.$dispose()
console.log(score.disposed, alive.disposed, title.disposed,
  samples.disposed, position.disposed)`
/** Store Light supplies the field context and owns deterministic cleanup. */
const builder = t(
  'Returns Store Light IFieldBuilder with FIELD_BUILDER true, mode StoreFieldMode.sync from @migaia/store-light and synchronous create(context). A sync-only annotation is typeof StoreFieldMode.sync, not the full IStoreFieldMode union that also permits async. After ensureWasm, pass it to createStore; Store Light supplies {runtime,signal,createSource} and owns the field. Creation before readiness fails NOT_INITIALIZED. An aborted context preserves an unclassified native reason in place with INIT_ABORTED, a complete foreign identity unchanged, or an untaggable reason on cause. Rollback preserves primary and cleanup failures. Direct create requires caller-owned disposal.',
  '返回轻量状态包字段构造协议，品牌为真、模式复用轻量状态包的同步常量，仅同步类型标注使用 `typeof StoreFieldMode.sync`，不能以还含异步分支的完整模式联合替代；创建方法同步接收含运行时、中止信号及响应源工厂的上下文；先等待初始化再交状态工厂，由状态容器拥有字段，未就绪抛 `NOT_INITIALIZED`；上下文中止为未编码原生原因原位附 `INIT_ABORTED`，完整外包身份不变，无法附码的原因保留在原因链；回滚保留主失败及清理失败，直接创建须由调用者负责销毁。'
)
/** Concrete scalar fields share tracking and cleanup while retaining distinct encodings. */
const scalar = (storage: IText): IText =>
  t(
    builder.en +
      ' Field exposes value getter/setter, readonly observed/disposed and idempotent dispose(): void. Reading tracks its source; Object.is-equal writes do nothing. Memory growth refreshes backing views. Disposed value access fails FIELD_DISPOSED. Disposal marks terminal, removes reactive sources then frees allocation. ' +
      storage.en,
    builder.zh +
      '产物提供可读写值、只读观察状态与销毁状态，以及无参数无返回值的幂等销毁。读取追踪响应源，同值写入跳过，内存增长后刷新视图，销毁后访问值抛字段已销毁错误，销毁先标记终态再移除响应源并释放分配。' +
      storage.zh
  )
/** Native helper signatures have distinct support for cause and aggregate errors. */
const errorDoc = (native: string, cause = false, aggregate = false) => ({
  role: 'error' as const,
  purpose: t(
    'Builds native ' +
      native +
      ' tagged with package source and selected stable code, preserving its stack and native runtime class.',
    '构造原生错误并附加本包来源及所选稳定错误码，保留堆栈与对应原生运行时类别。'
  ),
  params: {
    code: t(
      'Value from StoreWasmErrorCode for the actual failure branch.',
      '错误码表中对应实际失败分支的值。'
    ),
    ...(aggregate
      ? {
          errors: t(
            'Caller-collected failures retained by identity and order in AggregateError.errors.',
            '调用者收集的失败，以原始身份及顺序保留在聚合子项。'
          )
        }
      : {}),
    message: t('Caller-provided readable diagnostic message.', '调用者提供的可读诊断消息。')
  },
  ...(cause
    ? {
        optionDocs: {
          cause: {
            summary: t(
              'Original non-undefined failure retained as cause.',
              '非未定义的原始失败保留为原因。'
            ),
            default: t('Omitted: no cause attached.', '默认省略，不附加原因字段。')
          }
        },
        optionCases: [
          {
            title: t('Explain an invalid measurement import', '说明测量文件导入失败'),
            problem: t(
              'A chart editor imports measurements into WASM fields. If decoding fails, a generic import message hides the decoder failure. Attach it with `cause` so the page can name the failed operation while monitoring still receives the original stack.',
              '图表编辑器要把测量文件导入 WASM 字段。解码失败时，只有一句导入失败会掩盖解码器的原因。用 `cause` 保留它，页面说明哪项操作失败，监控也能查看原始堆栈。'
            ),
            example: `import { createStoreWasm${native}, StoreWasmErrorCode } from '@migaia/store-wasm'

try {
  await importMeasurements(file)
} catch (cause) {
  const error = createStoreWasm${native}(
    StoreWasmErrorCode.invalidOption,
    'Measurement import failed',
    { cause }
  )
  showImportError(error.message)
  reportToMonitoring(error)
}`,
            result: t(
              'The editor explains that measurement import failed; the monitoring entry keeps the decoder failure as its cause.',
              '编辑器提示测量文件导入失败；监控记录仍能沿 cause 找到解码器的原始失败。'
            ),
            covers: ['cause']
          },
          {
            title: t('Explain why opening the editor stopped', '说明编辑器为何停止打开'),
            problem: t(
              'An editor may stop opening when its route is left. A cancellation message alone loses the reason supplied by the navigation owner. Keeping `signal.reason` in `cause` lets the application report the cancelled operation together with that reason.',
              '离开路由时，编辑器可能停止打开。只有取消提示会丢失导航方提供的原因。把 `signal.reason` 留在 `cause` 中，应用就能同时记录被取消的操作和原始原因。'
            ),
            example: `import { createStoreWasm${native}, StoreWasmErrorCode } from '@migaia/store-wasm'

signal.addEventListener('abort', () => {
  const error = createStoreWasm${native}(
    StoreWasmErrorCode.initAborted,
    'Editor opening cancelled',
    { cause: signal.reason }
  )
  reportToMonitoring(error)
}, { once: true })`,
            result: t(
              'The cancelled editor opening is reported with the navigation reason available on the error cause.',
              '编辑器打开被取消时会留下记录，错误的 cause 保留导航方给出的原因。'
            ),
            covers: ['cause']
          }
        ]
      }
    : {}),
  returns: t(
    'Tagged ' + native + '; helper returns this object without throwing it.',
    '返回带身份的对应原生错误对象，辅助函数自身不抛出返回值。'
  ),
  example: `import { createStoreWasm${native}, StoreWasmErrorCode } from '@migaia/store-wasm'
const error = createStoreWasm${native}(StoreWasmErrorCode.${aggregate ? 'cleanupFailed' : 'invalidOption'}, ${aggregate ? '[new Error("release failed")], ' : ''}'WASM field failed')
console.log(error)`
})
/** Actual error branches determine recovery and retain native causes. */
const errors = {
  notInitialized: t(
    'Field creation ran before ensureWasm completed; await readiness first.',
    '字段创建早于初始化完成，应先等待就绪再创建。'
  ),
  fieldDisposed: t(
    'Disposed field is read or written; create another instance.',
    '读取或写入已销毁字段，应创建新的字段实例。'
  ),
  initAborted: t(
    'Field context signal was already aborted. Native reason identity, class and stack remain; unclassified extensible errors receive this code in place, complete foreign identities keep their owner, and frozen/non-Error reasons remain on cause.',
    '字段构造上下文信号已中止，原生原因保留身份、类型及堆栈；未编码可扩展错误原位附码，完整外包错误保持原归属，冻结或非错误原因保留在原因链。'
  ),
  reservedFieldName: t(
    'Record would shadow dispose/disposed lifecycle keys; rename the field.',
    '记录将覆盖销毁方法或状态保留键，应重命名字段。'
  ),
  allocationFailed: t(
    'Allocation/pointer handshake, alignment or stored string length is invalid.',
    '分配与指针对接、对齐或字符串存储长度无效。'
  ),
  invalidOption: t(
    'Invalid size, granularity, write type, string capacity, index or range.',
    '大小、粒度、写值类型、字符串容量、下标或范围无效。'
  ),
  cleanupFailed: t(
    'Several cleanup failures or rollback requires an aggregate to retain its primary.',
    '多项清理失败，或回滚需要聚合保留其原始主失败。'
  ),
  instancePoisoned: t(
    'Earlier WebAssembly.RuntimeError poisoned the shared arena; cause is the first trap. Reload/restart; allocation retries cannot repair it.',
    '先前原生运行时陷阱使共享分配器不可用，原因保留首个陷阱，须重载或重启，重试分配无法修复。'
  )
}

export const storeWasmReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Optional synchronous Store Light fields in shared module-wide WASM memory. Builders allocate only when fields are created, after ensureWasm. Arena helpers are internal; ordinary application cleanup awaits store.$dispose().',
        '模块级共享原生内存中的可选同步字段，描述构造器仅在初始化后创建字段时分配，分配器辅助属于内部机制，应用通常等待状态容器销毁清理。'
      ),
      example
    }
  },
  symbols: {
    ensureWasm: {
      role: 'operation',
      purpose: t(
        'Initializes @migaia/wasm once; pending and successful calls preserve one Promise identity. Failed initialization clears the attempt cache so another call can retry.',
        '初始化原生模块；等待中及成功后复用同一个 Promise，失败时清空尝试缓存，后续调用可重新加载。'
      ),
      returns: t(
        'Promise<WebAssembly.Memory> for shared memory, never caller-owned. Native WebAssembly.CompileError, LinkError and RuntimeError cross unchanged without source/code as the registered native pass-through exception. The original arena trap is rethrown unchanged; only later INSTANCE_POISONED failures carry the first trap on cause. This readiness Promise remains resolved after a later trap.',
        'Promise 返回共享内存，调用方不拥有其释放责任；原生编译、链接及运行时错误按已登记例外原样传播，不附来源或错误码。分配器首次陷阱原样重抛，后续 `INSTANCE_POISONED` 失败把首次陷阱保留在原因链；后来的陷阱不会改变已完成的就绪 Promise。'
      ),
      exampleIntro: nodeSetup,
      example: storeWasmCases.ensureWasm![0]!.example,
      cases: storeWasmCases.ensureWasm
    },
    number: {
      role: 'factory',
      purpose: t(
        'Describes an eight-byte little-endian f64 field, initially zero, with independent reactive tracking and Store Light ownership.',
        '描述初始零、八字节小端浮点数字段，具有独立响应追踪并由轻量状态容器拥有。'
      ),
      returns: scalar(
        t(
          'Value is number; typeof checking allows NaN/infinities. Object.is distinguishes signed zero. Non-number writes throw TypeError INVALID_OPTION.',
          '值为数字，类型检查允许非数及无穷值，同值比较区分正负零，非数字写入抛类型错误及无效选项码。'
        )
      ),
      exampleIntro: fieldIntro(
        t(
          'number() takes no arguments and starts at 0; value accepts JavaScript numbers. memory.grow(1) adds one 64 KiB page and returns the previous page count; this example compares buffer identity instead of relying on a fixed initial size. The retained field is unusable after Store disposal.',
          '`number()` 无参数，初始值 `0`，通过 `value` 读写数字。`memory.grow(1)` 增长一页 64 KiB 内存并返回增长前页数；示例只比较缓冲区身份，不依赖固定初始大小。Store 释放后，保留的字段引用也不能继续访问。'
        )
      ),
      example: storeWasmCases.number![0]!.example,
      cases: storeWasmCases.number
    },
    boolean: {
      role: 'factory',
      purpose: t(
        'Describes a one-byte boolean field initially false; accepts actual booleans without truthy coercion, owned by Store Light.',
        '描述初始假的单字节布尔字段，只接受真实布尔值而不做真值转换，由状态容器拥有。'
      ),
      returns: scalar(
        t(
          'Value is boolean; true encodes as one and false as zero. Other types throw TypeError INVALID_OPTION.',
          '值为布尔值，真编码为一、假为零，其他类型抛类型错误及无效选项码。'
        )
      ),
      example
    },
    string: {
      role: 'factory',
      purpose: t(
        'Describes initially empty UTF-8 bytes with fixed capacity plus four-byte length header; capacity never reallocates and oversized writes never truncate.',
        '描述初始空、由固定容量编码字节及四字节长度头组成的字符串，不重新分配容量，超大写入不截断。'
      ),
      params: {
        maxBytes: t(
          'Caller UTF-8 byte capacity, default 256; safe integer from 0 through 4294967291. Invalid size throws RangeError INVALID_OPTION at builder construction.',
          'UTF-8 字节容量默认 `256`，须为 `0` 至 `4294967291` 的安全整数；非法大小在构造描述时抛 `RangeError`，错误码为 `INVALID_OPTION`。'
        )
      },
      returns: scalar(
        t(
          'Value is string; TextEncoder byte count determines capacity, not character count. Non-string throws TypeError INVALID_OPTION; overflow throws Error INVALID_OPTION before commit. Reads decode current bytes; corrupt length fails ALLOCATION_FAILED.',
          '值为字符串，容量按编码字节数而非字符数计，非字符串抛类型错误，超容量在提交前抛普通无效选项错误，读取解码当前字节，损坏长度抛分配失败。'
        )
      ),
      exampleIntro: fieldIntro(
        t(
          'string(maxBytes = 256) creates an initially empty value. The example supplies 6 bytes; TextEncoder.encode(value).length measures that capacity in UTF-8. Assignment accepts a string and throws INVALID_OPTION before changing memory when its encoded length exceeds maxBytes.',
          '`string(maxBytes = 256)` 的初始值为空字符串；本例设为 `6` 字节，使用 `TextEncoder.encode(value).length` 查看 UTF-8 长度。赋值只接受字符串，编码长度超出 `maxBytes` 时先抛 `INVALID_OPTION`，不改现有字节。'
        )
      ),
      example: storeWasmCases.string![0]!.example,
      cases: storeWasmCases.string
    },
    array: {
      role: 'factory',
      purpose: t(
        'Describes fixed zero-filled f64 elements with shared tracking buckets. Call array(length, granularity?); there is no item builder parameter or compatibility overload for the old argument order.',
        '描述固定长度、初始零并共享追踪桶的浮点元素，参数仅为长度及可选桶粒度，不接收元素构造器，也不保留旧参数顺序的兼容重载。'
      ),
      params: {
        length: t(
          'Caller-selected safe integer from 0 through 536870911; immutable element count, invalid values fail RangeError INVALID_OPTION.',
          '调用者选择的零至 `536870911` 安全整数，为固定元素数量，无效值抛范围错误及无效选项码。'
        ),
        granularity: t(
          'Caller positive safe integer indices per bucket, default 64; one tracks each index independently, larger buckets can invalidate peers.',
          '每桶下标数须为正安全整数，默认 `64`；设为 `1` 时逐下标追踪，更大的桶可能使同桶其他读取者失效。'
        )
      },
      returns: t(
        builder.en +
          ' Field exposes readonly length/disposed, idempotent dispose(): void, at(index): number, setAt(index,value): void, setRange(lo,hi,values): void, view(): Float64Array. Indices are safe integers in [0,length); reads track buckets. Writes require number, including NaN/infinities. Range is half-open [lo,hi); all ArrayLike length and element reads finish before writes, so a getter failure leaves memory unchanged. Unclassified native input errors receive INVALID_OPTION in place, foreign identities remain unchanged, and frozen/non-Error failures remain on cause. Changed buckets commit once each in a batch; each commit refreshes the current memory view after owner-triggered memory growth, with attempted memory rollback on failure. view returns an independent copy without tracking, never writeback. After disposal data operations fail FIELD_DISPOSED; sources release before allocation.',
        builder.zh +
          '产物提供只读长度与销毁状态、幂等无参数销毁、按下标读写、范围写入及浮点视图方法。下标须为零含边界至长度不含边界的安全整数，读取追踪桶，写值须为数字且允许非数及无穷值。范围采用左闭右开，写入前完成全部类数组长度和元素读取，读取器失败不产生部分写入；未编码原生输入错误原位附 `INVALID_OPTION`，外包完整身份不变，冻结或非错误值保留在原因链。再批量为每个变化桶提交一次，提交回调内刷新当前内存视图，支持所有者在提交边界增长内存，失败尝试回滚内存。视图返回不追踪的独立拷贝，修改不回写，销毁后数据操作抛字段已销毁错误，清理先释放响应源再释放分配。'
      ),
      exampleIntro: fieldIntro(
        t(
          trackingSetup.en +
            ' array(length, granularity = 64) requires a fixed length; values begin at 0. at(index) and setAt(index, value) require a nonnegative valid index. setRange(lo, hi, values) targets [lo, hi), with exactly hi - lo numeric entries. view() takes no arguments and returns an independent Float64Array copy. The failed input getter deliberately throws its existing TypeError, whose identity and code are printed.',
          trackingSetup.zh +
            '`array(length, granularity = 64)` 的固定长度必填，初值均为 `0`。`at(index)` 与 `setAt(index, value)` 需要非负有效下标；`setRange(lo, hi, values)` 写入 `[lo, hi)`，输入须恰好有 `hi - lo` 个数字。`view()` 无参数，返回独立 Float64Array 副本。失败输入的访问器故意抛出已有 TypeError，输出会核对其身份和错误码。'
        )
      ),
      example: storeWasmCases.array![0]!.example,
      cases: storeWasmCases.array
    },
    record: {
      role: 'factory',
      purpose: t(
        'Describes fixed named f64 properties with tracking per key, not a dynamic dictionary. Keys are captured when the builder is constructed.',
        '描述逐键追踪的固定命名浮点属性而非动态字典，描述构造阶段即捕获全部字段键。'
      ),
      params: {
        shape: t(
          'Caller non-array object mapping keys to number() builders. Runtime checks FIELD_BUILDER branding only; other builders are unsupported. dispose/disposed reject RESERVED_FIELD_NAME when the field is created.',
          '调用者提供非数组对象，将键映射到数字构造器，运行时仅检查品牌，其他构造器不属于支持用法，销毁方法及状态键在创建字段时以保留字段名错误拒绝。'
        )
      },
      returns: t(
        builder.en +
          ' Field maps captured keys to direct number getter/setters (not .value), initially zero. Each read tracks its own source; Object.is-equal writes skip commit. Non-number throws TypeError INVALID_OPTION. Non-enumerable disposed and idempotent dispose(): void retain lifecycle ownership. Later property access fails FIELD_DISPOSED; cleanup releases sources before allocation. Nested records/arrays and dynamic keys are unsupported.',
        builder.zh +
          '产物把捕获键映射为初始零、直接可读写数字属性，不经过值包装，逐键读取追踪独立源，同值写入跳过，非数字写入抛类型错误。不可枚举的销毁状态及无参数无返回值幂等销毁方法保留生命周期所有权，销毁后属性访问抛字段已销毁错误，清理先响应源后分配，不支持嵌套记录数组及动态键。'
      ),
      exampleIntro: fieldIntro(
        t(
          trackingSetup.en +
            ' record(shape) requires a non-array object of number() builders. Here x and y are fixed numeric properties, initially 0; direct assignment writes their f64 values. Object.keys lists only business keys because dispose and disposed are non-enumerable lifecycle properties.',
          trackingSetup.zh +
            '`record(shape)` 需要由 `number()` 构造器组成的非数组对象；本例 `x`、`y` 是初始值 `0` 的固定数字属性，直接赋值即可写入 f64。`Object.keys` 只列出业务键，`dispose` 与 `disposed` 是不可枚举的生命周期属性。'
        )
      ),
      example: storeWasmCases.record![0]!.example,
      cases: storeWasmCases.record
    },
    createStoreWasmError: errorDoc('Error', true),
    createStoreWasmTypeError: errorDoc('TypeError', true),
    createStoreWasmRangeError: errorDoc('RangeError'),
    createStoreWasmAggregateError: errorDoc('AggregateError', false, true),
    STORE_WASM_SOURCE: {
      role: 'constant',
      purpose: t(
        'Source store.wasm for package-owned failures; interpret it with code. Complete foreign identities retain their owner. Registered native WebAssembly CompileError/LinkError/RuntimeError pass through unchanged without this source or a code.',
        '本包拥有的失败所附精确来源标记，应与稳定错误码联合检查；完整外包身份保持原归属，已登记的原生编译、链接及运行时错误原样透传，不附此来源或错误码。'
      ),
      example: `import { STORE_WASM_SOURCE } from '@migaia/store-wasm'
console.log(STORE_WASM_SOURCE)`
    },
    StoreWasmErrorCode: {
      role: 'constant',
      purpose: t(
        'Stable public construction, lifetime, memory and cleanup failure codes interpreted with source.',
        '与包来源联合解释的稳定公开构造、生命周期、内存及清理失败错误码表。'
      ),
      example: `import { StoreWasmErrorCode } from '@migaia/store-wasm'
console.log(StoreWasmErrorCode.notInitialized)`
    },
    WasmReservedKey: {
      role: 'constant',
      purpose: t(
        'Record property names reserved for cleanup and terminal state; caller fields must not shadow them.',
        '记录中为清理及终态保留的属性名，调用者字段不得覆盖这些生命周期成员。'
      ),
      example: `import { WasmReservedKey } from '@migaia/store-wasm'
console.log(WasmReservedKey.dispose, WasmReservedKey.disposed)`
    }
  },
  types: {
    IStoreWasmErrorCode: {
      summary: t(
        'Value union of the StoreWasmErrorCode runtime table, preserving package failure branches.',
        '运行时错误码表的值联合，保留本包实际失败语义分支。'
      ),
      members: {},
      example: `import { StoreWasmErrorCode, type IStoreWasmErrorCode } from '@migaia/store-wasm'
const code: IStoreWasmErrorCode = StoreWasmErrorCode.cleanupFailed`
    },
    IWasmReservedKey: {
      summary: t(
        'Union dispose or disposed, the record keys reserved for field lifetime.',
        '记录中为字段生命周期保留的销毁方法及销毁状态键值联合。'
      ),
      members: {},
      example: `import { WasmReservedKey, type IWasmReservedKey } from '@migaia/store-wasm'
const key: IWasmReservedKey = WasmReservedKey.dispose`
    }
  },
  enums: {
    StoreWasmErrorCode: {
      summary: t(
        'Error branches identified together with STORE_WASM_SOURCE.',
        '与本包来源联合识别的实际错误分支。'
      ),
      values: errors
    },
    WasmReservedKey: {
      summary: t(
        'Record keys protecting native field cleanup ownership.',
        '保护原生字段清理所有权的记录保留键。'
      ),
      values: {
        dispose: t(
          'Reserved idempotent cleanup method returning void.',
          '保留的幂等清理方法，无返回值。'
        ),
        disposed: t(
          'Reserved readonly field terminal-state accessor.',
          '保留的只读字段终态状态访问标记。'
        )
      }
    }
  },
  enhancers: {}
}
