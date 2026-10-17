/**
 * Checked against current field/arena source and README (2026-10-17). Root exports builders, not
 * concrete IWasm*Field type names or arena helpers. array does not inspect its item descriptor;
 * record checks branding only, though only number builders are supported and every slot is f64.
 * ensureWasm retains the settled Promise identity; explicit disposal is the ownership path.
 */
import type { ILibraryReference, IText } from './contract.js'

/** Localized source-backed contracts. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Full real builder-to-store path exercises all public field operations. */
const example = `import * as wasm from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
import { createRuntime } from '@migaia/reactive'

await wasm.ensureWasm()
const runtime = createRuntime()
const store = createStore({
  score: wasm.number(), alive: wasm.boolean(), title: wasm.string(64),
  samples: wasm.array(wasm.number(), 3, 1),
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
effect.dispose()
await store.$dispose()
console.log(store.score.disposed, store.alive.disposed, store.title.disposed,
  store.samples.disposed, store.position.disposed)`
/** Store Light supplies the field context and owns deterministic cleanup. */
const builder = t(
  'Returns Store Light IFieldBuilder with FIELD_BUILDER true, mode sync and synchronous create(context). After ensureWasm, pass it to createStore; Store Light supplies {runtime,signal,createSource} and owns the field. Creation before readiness fails NOT_INITIALIZED; aborted context fails INIT_ABORTED. Rollback preserves primary and cleanup failures. Direct create requires caller-owned disposal.',
  '返回轻量状态包字段构造协议，品牌为真、模式为同步，创建方法同步接收含运行时、中止信号及响应源工厂的上下文；先等待初始化再交状态工厂，由状态容器拥有字段，未就绪抛 `NOT_INITIALIZED`，上下文中止抛 `INIT_ABORTED`，回滚保留主失败及清理失败，直接创建须由调用者负责销毁。'
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
        }
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
    'Field context signal was already aborted; treat as cancellation.',
    '字段构造上下文信号已中止，应视为合作式取消。'
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
        '只初始化一次原生模块，等待中及成功后保持同一承诺身份，失败清空尝试缓存，允许后续调用重新加载。'
      ),
      returns: t(
        'Promise<WebAssembly.Memory> for shared memory; initialization failures propagate. Memory is not caller-owned. A later arena trap poisons allocations even though this readiness Promise remains resolved.',
        '承诺返回非调用者拥有的共享内存，初始化失败传播，后续分配陷阱会使实例不可用而就绪承诺仍保持兑现。'
      ),
      example: `import { ensureWasm } from '@migaia/store-wasm'
const ready = ensureWasm()
const memory = await ready
console.log(ready === ensureWasm(), memory.buffer.byteLength)`
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
      example
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
          '调用者选择的编码字节容量，默认二百五十六，须为零至 `4294967291` 安全整数，无效大小在描述构造阶段抛范围错误。'
        )
      },
      returns: scalar(
        t(
          'Value is string; TextEncoder byte count determines capacity, not character count. Non-string throws TypeError INVALID_OPTION; overflow throws Error INVALID_OPTION before commit. Reads decode current bytes; corrupt length fails ALLOCATION_FAILED.',
          '值为字符串，容量按编码字节数而非字符数计，非字符串抛类型错误，超容量在提交前抛普通无效选项错误，读取解码当前字节，损坏长度抛分配失败。'
        )
      ),
      example
    },
    array: {
      role: 'factory',
      purpose: t(
        'Describes fixed zero-filled f64 elements with shared tracking buckets. Only number() items are supported; _item is a type descriptor ignored at runtime.',
        '描述固定长度、初始零并共享追踪桶的浮点元素，仅支持数字元素构造器，元素描述参数在运行时被忽略。'
      ),
      params: {
        _item: t(
          'Builder returned by number(); it is not instantiated once per array element.',
          '由 `number()` 返回的构造描述，不会逐数组元素实例化。'
        ),
        length: t(
          'Caller-selected safe integer from 0 through 536870911; immutable element count, invalid values fail RangeError INVALID_OPTION.',
          '调用者选择的零至 `536870911` 安全整数，为固定元素数量，无效值抛范围错误及无效选项码。'
        ),
        granularity: t(
          'Caller positive safe integer indices per bucket, default 64; one tracks each index independently, larger buckets can invalidate peers.',
          '调用者选择的每桶下标数，须为正安全整数，默认六十四，取一独立追踪下标，更大桶可能使同桶依赖失效。'
        )
      },
      returns: t(
        builder.en +
          ' Field exposes readonly length/disposed, idempotent dispose(): void, at(index): number, setAt(index,value): void, setRange(lo,hi,values): void, view(): Float64Array. Indices are safe integers in [0,length); reads track buckets. Writes require number, including NaN/infinities. Range is half-open [lo,hi); all numeric values and exact ArrayLike length are validated before writes. Changed buckets commit once each in a batch, with attempted memory rollback on failure. view returns an independent copy without tracking, never writeback. After disposal data operations fail FIELD_DISPOSED; sources release before allocation.',
        builder.zh +
          '产物提供只读长度与销毁状态、幂等无参数销毁、按下标读写、范围写入及浮点视图方法。下标须为零含边界至长度不含边界的安全整数，读取追踪桶，写值须为数字且允许非数及无穷值。范围采用左闭右开，先校验全部数字及精确类数组长度，再批量为每个变化桶提交一次，失败尝试回滚内存。视图返回不追踪的独立拷贝，修改不回写，销毁后数据操作抛字段已销毁错误，清理先释放响应源再释放分配。'
      ),
      example
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
      example
    },
    createStoreWasmError: errorDoc('Error', true),
    createStoreWasmTypeError: errorDoc('TypeError', true),
    createStoreWasmRangeError: errorDoc('RangeError'),
    createStoreWasmAggregateError: errorDoc('AggregateError', false, true),
    STORE_WASM_SOURCE: {
      role: 'constant',
      purpose: t(
        'Exact package error source @migaia/store-wasm; interpret this marker together with code.',
        '本包错误附加的精确来源标记，应与稳定错误码联合检查来定位实际失败分支。'
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
    WasmFieldMode: {
      role: 'constant',
      purpose: t(
        'Synchronous create discriminant for all WASM builders; asynchronous module loading is handled separately by ensureWasm.',
        '全部原生字段构造器的同步创建判别值，异步模块加载由初始化方法单独负责。'
      ),
      example: `import { WasmFieldMode, number } from '@migaia/store-wasm'
console.log(WasmFieldMode.sync, number().mode)`
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
    IWasmFieldMode: {
      summary: t(
        'Only sync is supported; module initialization may be asynchronous but field create remains synchronous.',
        '仅支持同步模式，模块初始化可以异步而字段创建保持同步。'
      ),
      members: {},
      example: `import { WasmFieldMode, type IWasmFieldMode } from '@migaia/store-wasm'
const mode: IWasmFieldMode = WasmFieldMode.sync`
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
    WasmFieldMode: {
      summary: t(
        'Construction mode for native-backed field builders.',
        '原生内存字段构造器的创建模式。'
      ),
      values: {
        sync: t(
          'Field creation returns its instance synchronously after readiness.',
          '初始化完成后字段创建同步返回实例。'
        )
      }
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
