/**
 * Reference for `@migaia/store-shared`, checked against current source, README and USEGUIDE
 * 2026-10-18. Source differences: current shared ABI includes a header and 64-bit seqlocks; a
 * signal requires 32 bytes. readCell/writeCell versions are bigint, not number. peek reads current
 * shared memory consistently without publishing remote changes, rather than reading an old local
 * value. Invalid construction shapes use the native RangeError helper. snapshot guarantees a
 * consistent read per cell, not a transaction across all array elements.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'

/** Builds one localized sentence pair. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Two independent Runtime cursors observe the same physical signal. */
const signalExample = `import { createRuntime } from '@migaia/reactive'
import { sharedInt32 } from '@migaia/store-shared'

const writer = sharedInt32(createRuntime(), 0)
const reader = sharedInt32(createRuntime(), 999, writer.buffer)
const effect = reader.runtime.effect(() => console.log(reader.value))
writer.value = 2
console.log(reader.peek(), reader.isStale(), reader.sync(), reader.version)
effect.dispose()
reader.dispose()
writer.dispose()`

/** Array changes keep index dependencies separate and require explicit remote synchronization. */
const arrayExample = `import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'

const writer = sharedInt32Array(createRuntime(), 2, { initialValues: [1, 2] })
const reader = sharedInt32Array(createRuntime(), 2, { buffer: writer.buffer })
const effect = reader.runtime.effect(() => console.log(reader.get(0)))
writer.set(0, 3)
writer.update(1, (current) => current + 1)
console.log(reader.sync(), reader.snapshot())
effect.dispose()
reader.dispose()
writer.dispose()`

/** Watch is opt-in and its same stop handle can be called repeatedly. */
const watchExample = `import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'
import { systemScheduler } from '@migaia/utils/scheduler'

const array = sharedInt32Array(createRuntime(), 2)
const stop = array.watch(systemScheduler)
console.log(array.watch() === stop)
stop()
stop()
array.dispose()`

/** Low-level writes require explicit publication and local synchronization. */
const cellExample = `import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'

const array = sharedInt32Array(createRuntime(), 1)
const before = array.readCell(0)
const version = array.writeCell(0, before.value + 1, before.value)
if (version !== undefined) {
  array.notifyWaiters()
  array.sync(0)
}
array.assertActive()
console.log(array.readCell(0))
array.dispose()`

/** Core range and ownership facts are shared by both public wrappers and constructors. */
const runtimeParam = t(
  'IRuntime from @migaia/reactive createRuntime; it owns dependency tracking and watch error reporting for this instance.',
  '由响应包工厂返回的运行时，拥有当前实例依赖追踪及观察错误报告。'
)
/** Callers select valid indices from the fixed instance length. */
const indexParam = t(
  'Zero-based integer selected by the caller within zero inclusive and array.length exclusive.',
  '调用者在零含边界至数组长度不含边界之间选择的零起始整数下标。'
)
/** Writes reject silent int32 coercion at the validated public boundary. */
const valueParam = t(
  'Caller integer in the signed int32 range, from -2147483648 through 2147483647.',
  '调用者提供的有符号三十二位整数，范围为负 `2147483648` 至正 `2147483647`。'
)

/** Both classes share explicit asynchronous watcher ownership. */
const watchDoc: IMemberDoc = {
  summary: t(
    'Starts one Atomics.waitAsync wake loop that reconciles remote changes before each wait. It captures the expected version before sync, so a write during sync cannot become an unseen baseline. The stop handle is published before reconciliation, allowing reentrant stop/dispose. Active repeated calls retain the first scheduler and stop handle; no silent polling fallback is installed.',
    '启动单条原子异步等待唤醒回路，每次挂起前先对账远端变化，先捕获期望版本再同步，因此同步期间写入不会成为未见的新基线；对账前发布停止句柄，允许同步重入停止或销毁。活动期间重复调用保留首次调度器及停止句柄，不静默安装轮询降级。'
  ),
  params: {
    scheduler: t(
      'Optional IScheduler from @migaia/utils/scheduler; defaults to systemScheduler and controls zero-delay rescheduling and cancellation between wakeups.',
      '可选工具包调度器，默认系统调度器，控制唤醒间零延迟重调度及取消。'
    )
  },
  returns: t(
    'No-argument idempotent IDisposer. Missing waitAsync throws ENV_UNSUPPORTED; asynchronous loop failures are reported to Runtime. Disposing the instance also stops its loop without deleting shared memory.',
    '返回无参数幂等停止函数，缺少异步等待能力抛 `ENV_UNSUPPORTED`，异步回路失败报告给运行时，实例销毁也停止回路但不删除共享内存。'
  ),
  example: watchExample
}

/** Shared buffer metadata remains caller-visible after local reactive cleanup. */
const commonMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'Exact external Runtime supplied at construction, never transferred to another Runtime after creation.',
      '构造时提供的精确外包运行时，创建后不转属另一个运行时。'
    )
  },
  buffer: {
    summary: t(
      'Underlying SharedArrayBuffer issued by this constructor or attached from another instance.buffer. Share the buffer with another wrapper using the same kind and array length.',
      '由构造函数分配或从另一实例取得并附着的底层共享缓冲区，使用相同种类及数组长度创建另一包装来共享。'
    )
  },
  disposed: {
    summary: t(
      'Local wrapper terminal state; disposal disconnects this Runtime only and leaves other wrappers sharing the buffer alive.',
      '本地包装终态，销毁仅断开当前运行时，其他共享同一缓冲区的包装仍存活。'
    )
  },
  watch: watchDoc
}

/** Array attachment options are real constructor fields, not transport configuration. */
const arrayOptions: Readonly<Record<string, IMemberDoc>> = {
  buffer: {
    summary: t(
      'Existing buffer from another SharedInt32Array with identical length and current ABI header. Attaching never overwrites existing values.',
      '另一个相同长度且使用当前共享布局的数组缓冲区，附着不会覆盖已有值。'
    ),
    default: t(
      'Allocates a new SharedArrayBuffer for this fixed length, header and aligned 64-bit versions.',
      '默认为固定长度、头及对齐六十四位版本分配新共享缓冲区。'
    )
  },
  initialValues: {
    summary: t(
      'Caller-provided iterable of signed int32 values, consumed only for a new buffer and only through the required length prefix. Zero length does not pull the iterator. Reaching the prefix closes the iterator through native IteratorClose without reading one extra item; iteration failures become native RangeError INVALID_OPTION with the original cause.',
      '调用者提供的三十二位整数迭代源，仅新缓冲区消费所需长度的前缀；长度零不拉取，到达前缀即经原生迭代结束协议关闭，不额外读取下一项；迭代失败成为保留原始原因的原生范围错误及 `INVALID_OPTION`。'
    ),
    default: t(
      'Omitted; new cells contain zero. Ignored completely when attaching a buffer.',
      '默认省略，新格为零，附着已有缓冲区时完全忽略。'
    )
  }
}

/** Package failure codes preserve native class and cause identity. */
const errorValues = {
  arrayDisposed: t(
    'A validated array operation uses its disposed local wrapper; create another attached wrapper.',
    '校验型数组操作使用已销毁本地包装，需要新建附着包装。'
  ),
  signalDisposed: t(
    'Signal value, peek, sync or watch uses a disposed local wrapper.',
    '信号值、无追踪读取、同步或观察操作使用已销毁本地包装。'
  ),
  bufferTooSmall: t(
    'An attached buffer cannot hold the current signal or array layout; allocate the correct kind and size.',
    '附着缓冲区无法容纳当前信号或数组布局，需要正确种类及大小。'
  ),
  indexOutOfRange: t(
    'A validated array API receives a noninteger or out-of-range index.',
    '校验型数组接口收到非整数或越界下标。'
  ),
  contentionLimit: t(
    'A seqlock remains unstable or locked for the sustained contention window, or update exhausts its retry count; a crashed writer may require replacing the buffer.',
    '序列锁在持续争用窗口内不稳定或持锁，或更新耗尽重试次数，写者崩溃时可能需要替换缓冲区。'
  ),
  envUnsupported: t(
    'Explicit watch requires missing Atomics.waitAsync; callers may choose manual sync instead.',
    '显式观察要求的原子异步等待能力缺失，调用者可改为手动同步。'
  ),
  updateFailed: t(
    'An updater throws outside the lock. Unclassified extensible native errors receive UPDATE_FAILED in place, preserving identity, class and stack. Frozen or non-Error failures remain on cause; complete foreign source/code identities retain their owner.',
    '更新回调在锁外抛错；未编码且可扩展的原生错误原位附加 `UPDATE_FAILED`，保留身份、类型及堆栈；冻结或非错误值保留在原因链，已有完整外包来源及错误码保持原归属。'
  ),
  invalidOption: t(
    'Length, int32 value, buffer brand, ABI header or array options violate the supported construction/write domain.',
    '长度、整数值、缓冲区品牌、布局头或数组选项违反支持的构造写入值域。'
  )
}

/** Complete class and helper reference for current shared-memory ABI. */
export const storeSharedReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Fixed-layout shared int32 signal and index-granular array state using SharedArrayBuffer and Atomics. Start with sharedInt32 or sharedInt32Array, share their buffer, then explicitly sync or watch each reader Runtime.',
        '使用共享缓冲区及原子操作提供固定布局整数信号与逐下标数组状态，从共享信号或数组工厂开始，共享其缓冲区，并为各读者运行时显式同步或观察。'
      ),
      example: arrayExample
    }
  },
  symbols: {
    sharedInt32: {
      role: 'factory',
      purpose: t(
        'Creates or attaches a current-ABI shared scalar with independent local Runtime observation state. New buffers initialize once; supplied buffers preserve their existing value and must match the current scalar ABI.',
        '创建或附着当前布局共享标量，各本地运行时独立观察，新缓冲区初始化一次，提供的缓冲区保留已有值且须匹配当前标量布局。'
      ),
      params: {
        runtime: runtimeParam,
        initialValue: t(
          'Optional signed int32 initial value, default zero; ignored when a buffer is supplied.',
          '可选有符号三十二位初值，默认零，提供缓冲区时忽略。'
        ),
        buffer: t(
          'Optional current-ABI SharedArrayBuffer from another signal.buffer; default allocates 32 bytes. Old layouts or nonshared buffers reject rather than being reinterpreted.',
          '可选另一信号提供的当前布局共享缓冲区，默认分配三十二字节，旧布局或非共享缓冲区拒绝而不重新解释。'
        )
      },
      returns: t(
        'SharedInt32Signal owned by the caller. Invalid shape/value/header uses INVALID_OPTION; short buffers use BUFFER_TOO_SMALL; contention uses CONTENTION_LIMIT. Dispose only this local wrapper.',
        '返回调用者拥有的共享信号，非法形状、值或布局头使用 `INVALID_OPTION`，过短使用 `BUFFER_TOO_SMALL`，争用使用 `CONTENTION_LIMIT`，销毁仅影响当前包装。'
      ),
      example: signalExample
    },
    SharedInt32Signal: {
      role: 'factory',
      purpose: t(
        'Class form of sharedInt32. Constructor takes Runtime, optional initial int32 default zero and optional current-ABI shared buffer; same attach, initialization and local disposal semantics apply.',
        '共享信号工厂的类形式，构造接收运行时、默认零的可选整数及可选当前布局共享缓冲区，附着、初始化及本地销毁语义相同。'
      ),
      params: {
        runtime: runtimeParam,
        initialValue: valueParam,
        buffer: t(
          'Optional buffer obtained from another current signal instance; omitted means allocate a new scalar layout.',
          '可选另一当前信号实例提供的缓冲区，省略时分配新标量布局。'
        )
      },
      returns: t(
        'New SharedInt32Signal local reactive wrapper over new or attached shared storage; caller owns wrapper disposal, never the other wrappers sharing its buffer. Invalid initial value/buffer rejects construction with tagged native range errors.',
        '返回新建或附着共享存储上的本地响应信号包装，调用者负责当前包装销毁，不拥有同缓冲区其他包装，无效初值或缓冲区使构造抛带身份原生范围错误。'
      ),
      example: signalExample
    },
    sharedInt32Array: {
      role: 'factory',
      purpose: t(
        'Creates or attaches fixed-length shared int32 cells with a shared 64-bit generation and per-cell 64-bit seqlocks. Each reader owns its own cursors; get tracks only the indices read by that Runtime.',
        '创建或附着定长共享整数格，具有共享六十四位代次及每格六十四位序列锁，各读者拥有独立游标，读取仅追踪所属运行时读过的下标。'
      ),
      params: {
        runtime: runtimeParam,
        length: t(
          'Required nonnegative integer fixed length chosen by the application; attachment requires exactly the same header length and a supported typed-array layout size.',
          '应用选择的必填非负整数固定长度，附着要求头内长度完全相同且布局大小受类型数组支持。'
        )
      },
      optionDocs: arrayOptions,
      returns: t(
        'SharedInt32Array owned by the caller. Range errors cover invalid options/index/value or short buffers; contention is explicit. Host memory allocation limits may also throw native failures.',
        '返回调用者拥有的共享数组，范围错误覆盖非法选项、下标、值或过短缓冲区，争用显式失败，宿主内存分配限制也可抛原生失败。'
      ),
      example: arrayExample
    },
    SharedInt32Array: {
      role: 'factory',
      purpose: t(
        'Class constructor form of sharedInt32Array, taking Runtime, required fixed length and optional buffer/initialValues. Attaching validates ABI and length without reinitializing shared data.',
        '共享数组工厂的类构造形式，接收运行时、必填固定长度及可选缓冲区和初值迭代源，附着校验布局及长度而不重新初始化共享数据。'
      ),
      params: {
        runtime: runtimeParam,
        length: t(
          'Application-selected nonnegative integer fixed length.',
          '应用选择的非负整数固定长度。'
        )
      },
      optionDocs: arrayOptions,
      returns: t(
        'New SharedInt32Array local wrapper with an independent observation cursor for each shared cell. Dispose it when this Runtime no longer reads it; invalid length, header or initialization rejects construction without publishing a usable wrapper.',
        '返回为每个共享格保留独立观察游标的本地数组包装，当前运行时不再读取时应销毁，无效长度、头或初始化在发布可用包装前使构造失败。'
      ),
      example: arrayExample
    },
    STORE_SHARED_SOURCE: {
      role: 'error',
      purpose: t(
        'Canonical @migaia/store-shared source used together with StoreSharedErrorCode to classify package-owned shared-memory failures.',
        '规范共享存储错误来源，与语义错误码一起分类包拥有的共享内存失败。'
      ),
      example: `import { STORE_SHARED_SOURCE, StoreSharedErrorCode } from '@migaia/store-shared'
console.log(STORE_SHARED_SOURCE, StoreSharedErrorCode.contentionLimit)`
    },
    StoreSharedErrorCode: {
      role: 'error',
      purpose: t(
        'Eight stable package codes for local disposal, memory layout, index/value admission, updater failures, sustained contention and explicit watch capability. Native classes and original causes are retained; complete foreign identities remain with their owner.',
        '本地销毁、内存布局、下标值接纳、更新失败、持续争用及显式观察能力的八项稳定包错误码，保留原生错误类型及原始原因，完整外包错误身份保持原归属。'
      ),
      example: `import { StoreSharedErrorCode } from '@migaia/store-shared'
console.log(StoreSharedErrorCode.bufferTooSmall)`
    },
    ...Object.fromEntries(
      [
        ['createStoreSharedError', 'Error'],
        ['createStoreSharedRangeError', 'RangeError']
      ].map(([name, native]) => [
        name!,
        {
          role: 'operation' as const,
          purpose: t(
            `Creates a native ${native} tagged with shared-store source and chosen semantic code, keeping its runtime class, stack and optional original cause.`,
            `创建带共享存储来源及所选语义码的原生 \`${native}\`，保留运行时类型、堆栈及可选原始原因。`
          ),
          params: {
            code: t(
              'Semantic code selected from StoreSharedErrorCode.',
              '从共享存储错误表选择的语义码。'
            ),
            message: t(
              'Caller-owned diagnostic text describing the concrete shared-state failure.',
              '调用者拥有、描述具体共享状态失败的诊断文本。'
            )
          },
          optionDocs: {
            cause: {
              summary: t(
                'Original caller failure retained by native Error.cause identity.',
                '由原生错误原因属性按身份保留的调用者原始失败。'
              ),
              default: t('Omitted; no supplied cause is attached.', '默认省略，不附提供的原因。')
            }
          },
          returns: t(
            `Tagged native ${native} for the caller to return or throw.`,
            `返回供调用者返回或抛出的带码原生 \`${native}\`。`
          ),
          example: `import { ${name}, StoreSharedErrorCode } from '@migaia/store-shared'
console.log(${name}(StoreSharedErrorCode.invalidOption, 'invalid shared state'))`
        }
      ])
    )
  },
  types: {
    SharedInt32Signal: {
      summary: t(
        'One current-ABI scalar wrapper owned by a Runtime. Shared data persists with the buffer; graph observation, version cursor, watch loop and disposal belong to this local wrapper.',
        '单个运行时拥有的当前布局标量包装，共享数据随缓冲区保留，图观察、版本游标、等待回路及销毁归当前本地包装。'
      ),
      scenarios: [
        t(
          'Share a counter or integer flag across thread runtimes while each reader independently synchronizes notifications.',
          '跨线程运行时共享计数器或整数标志，各读者独立同步通知。'
        )
      ],
      example: signalExample,
      members: {
        ...commonMembers,
        subs: {
          summary: t(
            'Readonly external IObserver set owned by the canonical Runtime source binding; application code should observe through Runtime effects instead of mutating this set.',
            '规范运行时源绑定拥有的只读观察者集合，应用应经运行时效果观察，不修改此集合。'
          )
        },
        version: {
          summary: t(
            'Local reactive graph version number from the Runtime source binding; distinct from shared bigint seqlock versions.',
            '运行时源绑定提供的本地响应图版本数字，与共享大整数序列锁版本不同。'
          )
        },
        value: {
          summary: t(
            'Read consistently from shared memory, publish an unseen version and track a dependency. Setting validates signed int32, skips unchanged values and publishes local/remote notifications after commit.',
            '从共享内存一致读取，发布未见版本并追踪依赖，赋值校验整数范围，未变值跳过，提交后发布本地及远端通知。'
          ),
          params: { next: valueParam },
          returns: t(
            'Current integer on read; writes return no value. Disposed access uses SIGNAL_DISPOSED and invalid writes use INVALID_OPTION.',
            '读取返回当前整数，写入无返回值，销毁后访问使用 `SIGNAL_DISPOSED`，非法写入使用 `INVALID_OPTION`。'
          ),
          example: signalExample
        },
        sync: {
          summary: t(
            'Pulls the current shared version into the local cursor and notifies this Runtime only if it has not observed that version.',
            '把当前共享版本拉入本地游标，仅所属运行时尚未观察该版本时通知。'
          ),
          returns: t(
            'True for a newly observed version, otherwise false; SIGNAL_DISPOSED after disposal and CONTENTION_LIMIT if reads cannot settle.',
            '新观察版本返回真，否则为假，销毁后使用 `SIGNAL_DISPOSED`，读取无法稳定使用 `CONTENTION_LIMIT`。'
          ),
          example: signalExample
        },
        peek: {
          summary: t(
            'Consistently reads current shared memory without dependency tracking, updating the observed cursor or notifying local observers.',
            '一致读取当前共享内存，不追踪依赖，不更新已观察游标，也不通知本地观察者。'
          ),
          returns: t(
            'Current shared integer even if remote changes have not been published locally; disposed access throws SIGNAL_DISPOSED.',
            '即使远端变化尚未本地发布也返回当前共享整数，销毁后访问抛信号销毁错误。'
          ),
          example: signalExample
        },
        isStale: {
          summary: t(
            'Compares shared seqlock version with the local observed cursor without tracking or notification; this low-level hook does not perform the public active guard.',
            '比较共享序列锁版本与本地已观察游标，不追踪或通知，此低层钩子不执行公开活动检查。'
          ),
          returns: t(
            'True when the shared version differs, otherwise false; contention failures propagate.',
            '共享版本不同时为真，否则为假，争用失败传播。'
          ),
          example: signalExample
        },
        onObserved: {
          summary: t(
            'External observable protocol hook; currently a no-op and does not start watch automatically.',
            '外部可观察协议钩子，当前为空操作，不自动启动等待观察。'
          ),
          returns: t('No result and no new watcher is created.', '无返回值，不创建新等待观察者。'),
          example: `import { createRuntime } from '@migaia/reactive'
import { sharedInt32 } from '@migaia/store-shared'
const signal = sharedInt32(createRuntime())
signal.onObserved()
signal.onUnobserved()
signal.dispose()`
        },
        onUnobserved: {
          summary: t(
            'External observable protocol hook; currently a no-op, so explicit watch ownership remains with its stop handle or dispose.',
            '外部可观察协议钩子，当前为空操作，显式等待观察所有权仍归停止句柄或销毁。'
          ),
          returns: t(
            'No result; explicit watchers are unchanged.',
            '无返回值，不改变显式等待观察者。'
          ),
          example: signalExample
        },
        dispose: {
          summary: t(
            'Idempotently stops its watch and disposes this Runtime source binding; shared memory and other attached wrappers are untouched.',
            '幂等停止等待观察并销毁所属运行时源绑定，共享内存及其他附着包装仍保留。'
          ),
          returns: t(
            'No result; later value, peek, sync and watch reject with SIGNAL_DISPOSED.',
            '无返回值，后续值访问、无追踪读取、同步及等待观察以信号销毁错误拒绝。'
          ),
          example: signalExample
        }
      }
    },
    SharedInt32Array: {
      summary: t(
        'Fixed-length shared array implementing IDisposable, with independent local cursors and lazily tracked per-index graph sources. The whole array is not an IObservable and has no whole-array isStale. Disposal disconnects local sources without freeing shared backing.',
        '实现销毁协议、具有独立本地游标及惰性逐下标图源的定长共享数组，数组整体不是可观察图源，也没有整体过期检查；销毁断开本地源而不释放共享底层。'
      ),
      scenarios: [
        t(
          'Track entity coordinates independently without waking every observer after a single index changes.',
          '独立追踪实体坐标，单下标变更无需唤醒全部观察者。'
        )
      ],
      example: arrayExample,
      members: {
        ...commonMembers,
        length: {
          summary: t(
            'Application-selected fixed cell count, copied into the ABI header and checked on attachment.',
            '应用选择的固定格数，复制到共享布局头并在附着时检查。'
          )
        },
        get: {
          summary: t(
            'Reads a validated cell; inside Runtime tracking it materializes or reuses only that index source, otherwise it reads directly.',
            '读取已校验格，运行时追踪内仅实例化或复用当前下标源，其他情况直接读取。'
          ),
          params: { index: indexParam },
          returns: t(
            'Current consistent int32 value; invalid index uses INDEX_OUT_OF_RANGE, disposed access ARRAY_DISPOSED.',
            '返回当前一致整数值，非法下标使用越界错误，销毁后访问使用数组销毁错误。'
          ),
          example: arrayExample
        },
        set: {
          summary: t(
            'Writes a validated int32 and publishes only if its value changes; observers of other indices are not invalidated.',
            '写入已校验整数，仅值变化时发布，其他下标观察者不失效。'
          ),
          params: { index: indexParam, value: valueParam },
          returns: t(
            'No result; local cell tracking and shared generation publication are handled for this write.',
            '无返回值，当前写入的本地格追踪及共享代次发布已处理。'
          ),
          example: arrayExample
        },
        update: {
          summary: t(
            'Reads consistently, executes the callback outside the lock and attempts expected-value commit, retrying when a writer wins. User code never runs while the seqlock is held.',
            '一致读取，在锁外执行回调并尝试期望值提交，其他写者先成功时重试，用户代码不在持锁期间执行。'
          ),
          params: {
            index: indexParam,
            update: t(
              'Synchronous current-to-next int32 callback, pure and repeatable because contention can invoke it again. Return a valid integer. It runs outside the lock; thrown native errors retain identity/class/stack with UPDATE_FAILED when unclassified, complete foreign identities remain unchanged, and other failures remain on cause.',
              '同步当前值转新整数回调，因争用可重调而须纯净可重复，返回合法整数；回调在锁外执行，未编码原生错误原位附更新失败码并保留身份类型堆栈，完整外包身份不变，其他失败保留在原因链。'
            )
          },
          returns: t(
            'Committed next integer or unchanged current integer; retry exhaustion uses CONTENTION_LIMIT, invalid output INVALID_OPTION.',
            '返回已提交新整数或未变当前整数，重试耗尽使用争用错误，非法输出使用选项错误。'
          ),
          example: arrayExample
        },
        sync: {
          summary: t(
            'Publishes unseen remote cell versions locally. With an index checks one cell; without one scans only after the shared generation changes, batching notifications.',
            '本地发布未见远端格版本，提供下标检查一格，否则仅共享代次变化后扫描并批处理通知。'
          ),
          params: {
            index: t(
              'Optional valid index; defaults to all cells after the generation gate.',
              '可选合法下标，默认经代次门后检查全部格。'
            )
          },
          returns: t(
            'Changed cell count; indexed calls return zero or one. Every wrapper owns its cursor, so one reader cannot consume another reader update.',
            '返回变化格数，单格为零或一，每包装拥有独立游标，一个读者不会消费另一个读者更新。'
          ),
          example: arrayExample
        },
        snapshot: {
          summary: t(
            'Allocates a nonshared Int32Array and consistently reads each cell into it. Concurrent writers may change other cells between reads, so this is not an atomic whole-array transaction.',
            '分配非共享整数数组并逐格一致读入，并发写者可在格间读取期间修改其他格，因此不是全数组原子事务。'
          ),
          returns: t(
            'New independently owned Int32Array with the observed cell values; contention or disposed access can reject.',
            '返回独立拥有、含观察格值的新整数数组，争用或销毁后访问可失败。'
          ),
          example: arrayExample
        },
        dispose: {
          summary: t(
            'Idempotently stops its watcher and disposes all materialized local index sources, preserving shared backing and other readers.',
            '幂等停止等待观察并销毁全部已实例化本地下标源，保留共享底层及其他读者。'
          ),
          returns: t(
            'No result; validated public operations subsequently reject ARRAY_DISPOSED.',
            '无返回值，后续校验型公开操作以数组销毁错误拒绝。'
          ),
          example: arrayExample
        },
        assertActive: {
          summary: t(
            'Explicit local lifetime check for composition callers; does not read or synchronize shared cells.',
            '供组合调用者显式检查本地生命周期，不读取或同步共享格。'
          ),
          returns: t(
            'No result while active; ARRAY_DISPOSED after disposal.',
            '活动时无返回值，销毁后抛数组销毁错误。'
          ),
          example: cellExample
        },
        readCell: {
          summary: t(
            'Low-level consistent value/version read without public index, active checks or graph tracking. Use get for validated application access.',
            '不执行公开下标、活动检查或图追踪的低层一致值版本读取，应用校验访问使用普通读取。'
          ),
          params: { index: indexParam },
          returns: t(
            '{ value: number, version: bigint } from one stable cell observation; native indexing or contention failures can propagate.',
            '返回同一稳定格观察的数字值与大整数版本，原生下标或争用失败可传播。'
          ),
          example: cellExample
        },
        writeCell: {
          summary: t(
            'Low-level expected-value seqlock write without public int32, index or lifetime checks. Pair with notifyWaiters and local sync for publication; ordinary callers should use set or update.',
            '不执行公开整数、下标或生命周期检查的低层期望值写入，搭配 `notifyWaiters` 及本地 `sync` 发布，普通调用者应使用校验写入或更新。'
          ),
          params: {
            index: indexParam,
            value: valueParam,
            expected: t(
              'Optional expected current int32 from readCell; defaults to unconditional write. A mismatching expectation performs no commit.',
              '可选来自一致读格的当前期望整数，默认无条件写入，期望不匹配不提交。'
            )
          },
          returns: t(
            'New bigint version after a changed commit, or undefined for unchanged value or expectation mismatch. No notifications are published by this method alone.',
            '变化提交后返回新大整数版本，未变值或期望不匹配返回未定义，仅此方法不发布通知。'
          ),
          example: cellExample
        },
        notifyWaiters: {
          summary: t(
            'Advances the shared 64-bit generation and wakes independent array waiters without advancing this reader full-scan cursor. Pair writeCell with notifyWaiters then sync(index); sync publishes existing local cells and manages their cursor, so no manual recordObservedVersion is needed.',
            '推进共享六十四位代次并唤醒独立数组等待者，不提前推进当前读者的完整扫描游标；低层提交后搭配 `writeCell` 依次通知再调用 `sync` 发布已有本地格，同步路径管理游标，无须重复手抄版本。'
          ),
          returns: t(
            'No result; remote watch loops can now pull the new generation.',
            '无返回值，远端等待回路现在可拉取新代次。'
          ),
          example: cellExample
        },
        recordObservedVersion: {
          summary: t(
            'Updates this array local cursor only; composition callers use it after their own notification path. It neither changes shared data nor emits graph notifications.',
            '仅更新当前数组本地游标，组合调用者在自身通知路径后使用，不改变共享数据或发射图通知。'
          ),
          params: {
            index: indexParam,
            version: t(
              'Exact bigint version returned by readCell or a successful writeCell commit.',
              '来自一致读格或成功低层提交的精确大整数版本。'
            )
          },
          returns: t(
            'No result; later array-level sync compares against the supplied cursor.',
            '无返回值，后续数组级同步会与给定游标比较。'
          ),
          example: cellExample
        }
      }
    },
    IStoreSharedErrorCode: {
      summary: t(
        'Value union of package shared-state semantic codes, classified together with STORE_SHARED_SOURCE.',
        '与规范共享状态来源一起分类的包共享状态语义码值联合。'
      ),
      example: arrayExample,
      members: {}
    }
  },
  enums: {
    StoreSharedErrorCode: {
      summary: t(
        'Shared wrapper lifecycle, layout, input, contention and watcher capability failure codes.',
        '共享包装生命周期、布局、输入、争用及等待能力失败码。'
      ),
      values: errorValues
    }
  },
  enhancers: {}
}
