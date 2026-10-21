/**
 * Reference documentation of `@migaia/store-light`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/store-light/src` (reactive-store.ts, store-protocol.ts, store-resource*.ts,
 * field-mode-constants.ts, resource-state-constants.ts, error-code.ts), README and USEGUIDE on
 * 2026-10-18.
 */
import type { ICode, ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'
import { storeLightCases } from './store-light-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Short type doc for helper types. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

/** Store example shared by `createStore` and `IReactiveStore`. */
const storeExample: ICode = {
  en: `import { createStore } from '@migaia/store-light'

const counter = createStore({
  count: 0,
  get doubled() {
    return this.count * 2 // a cached computed value
  },
  increment() {
    this.count += 1 // methods are batched actions
  }
})
const stop = counter.$subscribe(() => console.log(counter.count))
counter.increment() // logs 1
console.log(counter.doubled) // 2
stop()
await counter.$dispose()`,
  zh: `import { createStore } from '@migaia/store-light'

const counter = createStore({
  count: 0,
  get doubled() {
    return this.count * 2 // 带缓存的计算值
  },
  increment() {
    this.count += 1 // 方法会成为自动批量的 action
  }
})
const stop = counter.$subscribe(() => console.log(counter.count))
counter.increment() // 输出 1
console.log(counter.doubled) // 2
stop()
await counter.$dispose()`
}

/** Resource example shared by `createStoreResource` and `IStoreResource`. */
const resourceExample: ICode = {
  en: `import { createStoreResource } from '@migaia/store-light'

const user = createStoreResource(
  async ({ signal }) => (await fetch('/api/user', { signal })).json(),
  { keepAliveMs: 30_000 }
)
user.preload() // start loading before render
const release = user.retainResource() // keep it while the page is open
// in a component: const value = user.read() (throws a Promise while loading)
user.retry() // reload; the old value stays readable meanwhile
release()
user.dispose()
await user.whenTerminal()`,
  zh: `import { createStoreResource } from '@migaia/store-light'

const user = createStoreResource(
  async ({ signal }) => (await fetch('/api/user', { signal })).json(),
  { keepAliveMs: 30_000 }
)
user.preload() // 渲染前开始加载
const release = user.retainResource() // 页面打开期间保持持有
// 在组件中：const value = user.read()（加载中会抛出 Promise）
user.retry() // 重新加载；期间旧值仍可读取
release()
user.dispose()
await user.whenTerminal()`
}

/** Members of the `$` API of a store. */
const storeMembers: Readonly<Record<string, IMemberDoc>> = {
  $runtime: {
    summary: t(
      'Reactive runtime captured at construction. This public data property is writable; assigning it does not migrate the closed-over Runtime owner.',
      '构造时捕获的响应式运行时；此公开数据属性可写，改写不会迁移闭包内的运行时所有者。'
    )
  },
  $async: {
    summary: t(
      'Initially `true` when asynchronous fields were admitted. This public data property is writable and does not control initialization.',
      '初值表示是否接纳过异步字段；此公开数据属性可写，改写不控制初始化。'
    )
  },
  $snapshot: {
    summary: t(
      'Returns a plain object with every field value, including computed and custom fields; throws while async fields are pending.',
      '返回包含全部字段值（包括计算值与自定义字段）的普通对象；异步字段未就绪时抛错。'
    ),
    returns: t('A new plain snapshot object.', '新的普通快照对象。'),
    example: `counter.$snapshot() // { count: 1, doubled: 2 }`
  },
  $subscribe: {
    summary: t(
      'Reads signal, computed and custom sources when subscribing, evaluating computed getters to capture dependencies outside this store. Later changes call `fn`; listener throws/rejections go to the Runtime reporter.',
      '建立订阅时读取普通字段、计算值及自定义来源，并求值计算访问器以捕获仓库外依赖。后续变化调用 `fn`；监听者抛错或拒绝交给运行时报告。'
    ),
    params: {
      fn: t(
        'Callback without arguments; read the store inside it.',
        '无参数的回调；在其中读取 Store。'
      ),
      options: t(
        '`{ fireImmediately? }`: `true` also calls `fn` once right away; default `false`.',
        '`{ fireImmediately? }`：为 `true` 时订阅后立即调用一次 `fn`；默认 `false`。'
      )
    },
    returns: t('A function that unsubscribes.', '取消订阅的函数。'),
    example: `const stop = counter.$subscribe(() => save(counter.$plain()), { fireImmediately: true })`
  },
  $batch: {
    summary: t(
      'Changes several fields with one notification. Not a transaction: a throw does not roll back earlier writes.',
      '修改多个字段但只触发一次通知。它不是事务：中途抛错不会回滚之前的写入。'
    ),
    params: {
      recipe: t(
        '`(draft) => void`; assign fields on `draft`.',
        '`(draft) => void`；在 `draft` 上给字段赋值。'
      )
    },
    returns: t('Nothing; dependants were notified once.', '无返回值；依赖方只被通知一次。'),
    example: `counter.$batch((draft) => {
  draft.count = 10
})`
  },
  $set: {
    summary: t(
      'Assigns several writable fields from a patch in one batch.',
      '用补丁对象在一个批次中给多个可写字段赋值。'
    ),
    params: {
      patch: t(
        'Partial object of writable (signal) fields; other keys throw `INVALID_OPTION`.',
        '可写（普通）字段组成的部分对象；其它 key 抛 `INVALID_OPTION`。'
      )
    },
    returns: t('Nothing; the fields are updated.', '无返回值；字段已更新。'),
    example: `counter.$set({ count: 5 })`
  },
  $plain: {
    summary: t(
      'Returns only the persistable plain fields (no computed, custom fields or methods); works before the store is ready.',
      '只返回可持久化的普通字段（不含计算值、自定义字段与方法）；Store 未就绪时也可调用。'
    ),
    returns: t('A plain object for storage or JSON.', '可用于存储或 JSON 的普通对象。'),
    example: `localStorage.setItem('counter', JSON.stringify(counter.$plain()))`
  },
  $hydrate: {
    summary: t(
      'Writes saved values back into plain fields through the mutation policy and one notification batch. It is not a rollback transaction: earlier writes survive a later failure.',
      '经写入策略在一次通知批处理中把保存值写回普通字段；这不是回滚事务，后续失败不会撤销先前写入。'
    ),
    params: {
      partial: t('Saved object, usually from `$plain()`.', '保存的对象，通常来自 `$plain()`。'),
      options: t(
        '`{ unknown?, onUnknown? }`; see `IHydrateOptions`.',
        '处理未知字段的选项 `{ unknown?, onUnknown? }`，见 `IHydrateOptions`。'
      )
    },
    returns: t('Nothing; known fields are written.', '无返回值；已知字段已写入。'),
    example: `counter.$hydrate(JSON.parse(saved), { unknown: 'report', onUnknown: (key) => console.warn(key) })`
  },
  $disposed: {
    summary: t(
      '`true` after `$dispose()` was called.',
      '调用过 `$dispose()` 之后为 `true`；这是只读终态查询，释放后仍可读取。'
    )
  },
  $own: {
    summary: t(
      'Adds an external disposable to this live store so `$dispose()` releases it too. After disposal, `$own` rejects with STORE_DISPOSED.',
      '把外部可释放资源纳入存活的仓库，由 `$dispose()` 一并释放；仓库释放后 `$own` 抛 `STORE_DISPOSED`。'
    ),
    params: {
      resource: t(
        'Object with `dispose()` and `disposed`, owned by no other runtime.',
        '带 `dispose()` 与 `disposed` 的对象，不能属于其它运行时。'
      )
    },
    returns: t('The same resource.', '同一个资源对象。'),
    example: `const items = counter.$own(createCollection())`
  },
  $dispose: {
    summary: t(
      'Releases fields, subscriptions and owned resources in reverse registration order. Reentrant and later calls return the same completion Promise. Field access and guarded methods reject with STORE_DISPOSED; disposal and terminal metadata remain available.',
      '按登记逆序释放字段、订阅和拥有的资源；重入与后续调用返回同一完成承诺。字段访问与受守卫方法抛 `STORE_DISPOSED`，重复释放和终态信息仍可使用。'
    ),
    returns: t(
      'Always the same Promise, resolved when cleanup finished.',
      '始终是同一个 Promise，清理完成后 resolve。'
    ),
    example: `await counter.$dispose()`
  }
}

/** Fields of the resource options (`IStoreResourceOptions`, `IStoreResourceConfig`). */
const resourceOptionFields: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'Runtime that owns idle cleanup and failure reporting.',
      '负责空闲清理与失败上报的运行时。'
    ),
    default: t('The shared default runtime.', '共享的默认运行时。')
  },
  scheduler: {
    summary: t(
      'Clock for the cache TTL and the 4000 ms render capture window.',
      '缓存有效期与 4000 毫秒渲染捕获窗口所用的时钟。'
    ),
    default: t('`systemScheduler`.', '`systemScheduler`：宿主原生计时器。')
  },
  keepAliveMs: {
    summary: t(
      'How long a loaded value stays cached after the last holder released it; `0` evicts at once.',
      '最后一个持有者释放后，已加载的值继续缓存的时长；`0` 表示立即释放。'
    ),
    default: t('`1000`.', '默认值为 `1000` 毫秒。')
  },
  dispose: {
    summary: t(
      'Cleans up an evicted object/function value; returns void or PromiseLike<void>. Physical cleanup may finish after logical disposal; await whenTerminal for completion.',
      '清理被逐出的对象或函数值，返回无值或可同化的异步清理结果；物理清理可能晚于逻辑释放，等待 `whenTerminal` 才确认完成。'
    ),
    default: t(
      'Not set: a value with `$dispose()` (such as a store) is disposed automatically.',
      '不设置：带 `$dispose()` 的值（例如另一个 Store）会被自动释放。'
    )
  },
  onError: {
    summary: t(
      '`(error, phase)` observes failures in `load`, `dispose` or `listener`.',
      '回调 `(error, phase)` 观察 `load`、`dispose` 或 `listener` 阶段的失败。'
    ),
    default: t(
      'Not set: failures go to the runtime reporter.',
      '不设置：失败交给运行时的上报函数。'
    )
  },
  onTerminal: {
    summary: t(
      'Called once at logical terminal disposal; asynchronous value cleanup may still be running. Await whenTerminal for physical completion.',
      '资源到达逻辑终态时调用一次，异步值清理可能仍在执行；物理完成须等待 `whenTerminal`。'
    ),
    default: t('Not set.', '不设置：不做额外处理。')
  }
}

/** Reference of `@migaia/store-light`. */
export const storeLightReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Reactive plain-object state: `createStore({...})` turns plain fields into signals, `get` accessors into cached computed values and methods into batched actions; `$` methods snapshot, subscribe, persist and dispose. `createStoreResource()` is a Suspense-safe adapter over @migaia/resource. Dependencies point inward to reactive, resource, lifecycle, event-subscriber and utils; no UI or host layer is required.',
        '响应式的普通对象状态：`createStore({...})` 把普通字段变为信号、`get` 访问器变为带缓存的计算值、方法变为自动批量的 action；`$` 开头的方法用于快照、订阅、持久化与释放。`createStoreResource()` 是资源包上的安全挂起适配器；依赖向内指向响应式内核、资源、生命周期、事件订阅与基础工具，不依赖界面或宿主层。'
      ),
      example: storeExample
    }
  },
  symbols: {
    createStore: {
      role: 'factory',
      purpose: t(
        'Creates a reactive store from an object literal: plain values become signals, getters cached computed values, methods actions (batched, untracked). Asynchronous field builders are rejected; use `createAsyncStore`.',
        '由对象字面量创建响应式 Store：普通值成为信号，getter 成为带缓存的计算值，方法成为 action（自动批量、不追踪依赖）。不接受异步字段构建器；请改用 `createAsyncStore`。'
      ),
      params: {
        shape: t(
          'Object literal with fields, getters, methods, raw values and explicit sync field builders. Keys must not collide with built-in $ APIs; a collision throws INVALID_OPTION TypeError and rolls back construction.',
          '包含字段、访问器、方法、原样值及显式同步字段构建器的对象字面量；键不得与内置接口重名，冲突以 `INVALID_OPTION` 类型错误拒绝并回收同次构造资源。'
        ),
        options: t(
          '`ICreateStoreOptions`: `runtime`, `debugName`, `warnAsyncActions`, `mutationPolicy`.',
          '创建选项 `ICreateStoreOptions`：`runtime`、`debugName`、`warnAsyncActions`、`mutationPolicy`。'
        )
      },
      returns: t(
        'An `IReactiveStore`: the same keys plus the `$` API.',
        '一个 `IReactiveStore`：保留原有的键，并带有 `$` 开头的 API。'
      ),
      options: 'ICreateStoreOptions',
      example: storeExample,
      cases: storeLightCases.createStore,
      scenarios: [
        t(
          'Form, settings or session state without writing signals by hand.',
          '表单、设置或会话状态，无需手写信号。'
        ),
        t(
          'One isolated runtime per SSR request or test.',
          '每个 SSR 请求或每个测试使用一个隔离的运行时。'
        )
      ],
      avoid: [
        t(
          'Large or frequently changing lists: use `@migaia/store-indexed`.',
          '大型或频繁增删的列表：请使用 `@migaia/store-indexed`。'
        )
      ]
    },
    createAsyncStore: {
      role: 'factory',
      purpose: t(
        'Same as `createStore` but accepts asynchronous field builders; resolves when every field is ready.',
        '与 `createStore` 相同，但接受异步字段构建器；所有字段就绪后 resolve。'
      ),
      params: {
        shape: t(
          'Object literal that may contain `mode: "async"` field builders.',
          '可以包含 `mode: "async"` 字段构建器的对象字面量。'
        ),
        options: t(
          'Same `ICreateStoreOptions` as `createStore`.',
          '与 `createStore` 相同的创建选项 `ICreateStoreOptions`。'
        )
      },
      returns: t(
        'A Promise of the ready store. Unclassified initialization errors receive INITIALIZATION_FAILED while retaining native identity or the original cause. Cleanup failures attach through cause to a writable primary Error; otherwise INIT_AND_CLEANUP_FAILED aggregates the original first. Late field disposal failures reach the Runtime as FIELD_DISPOSE_FAILED, preserving the original.',
        '返回就绪仓库的承诺。未分类初始化错误附 `INITIALIZATION_FAILED` 并保留原生身份或原始原因。清理失败附到可写主错误的原因链，否则以 `INIT_AND_CLEANUP_FAILED` 聚合且原错在先；晚到字段清理失败以 `FIELD_DISPOSE_FAILED` 交运行时报告并保留原错。'
      ),
      options: 'ICreateStoreOptions',
      example: `const store = await createAsyncStore({ count: 0, buffer: wasmNumber(0) })`
    },
    storeReady: {
      role: 'operation',
      purpose: t(
        'Returns the initialisation Promise of a store created by this module.',
        '返回由本模块创建的 Store 的初始化 Promise，用于等待异步字段就绪。'
      ),
      params: {
        store: t(
          'A store from `createStore` or `createAsyncStore`.',
          '由 `createStore` 或 `createAsyncStore` 创建的 Store。'
        )
      },
      returns: t(
        'Returns the registered readiness Promise for synchronous and asynchronous stores from this package instance. Only unregistered objects throw NO_ASYNC_INIT.',
        '同步与异步仓库都返回本包实例登记的就绪承诺；仅未登记对象抛 `NO_ASYNC_INIT`。'
      ),
      example: `await storeReady(store)`
    },
    raw: {
      role: 'factory',
      purpose: t(
        'Marks a value (usually a function) to be stored as a plain writable field instead of becoming an action.',
        '标记一个值（通常是函数），使其作为普通可写字段保存，而不是变成 action。'
      ),
      params: { value: t('The value to store as is.', '需要原样保存的值。') },
      returns: t(
        'An `IRaw` wrapper understood by `createStore`.',
        '`createStore` 能识别的 `IRaw` 包装对象。'
      ),
      example: `const form = createStore({ onSubmit: raw((data: FormData) => console.log(data)) })
form.onSubmit = (data) => save(data)`,
      cases: storeLightCases.raw
    },
    isRaw: {
      role: 'operation',
      purpose: t(
        'Tells whether a value was wrapped with `raw()`.',
        '判断某个值是否经过 `raw()` 包装，即会被 Store 当作普通字段保存。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for `raw()` wrappers.', '是 `raw()` 包装时返回 `true`。'),
      example: `isRaw(raw(() => {})) // true`
    },
    isFieldBuilder: {
      role: 'operation',
      purpose: t(
        'Checks the FIELD_BUILDER brand without admitting construction. Supported builders select explicit sync or async mode; construction rejects a missing or invalid mode.',
        '检查字段构建器品牌，不代表构造已获接纳；受支持构建器须显式选择同步或异步模式，缺失或非法模式在构造时拒绝。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for field builders.', '是字段构建器时返回 `true`。'),
      example: `isFieldBuilder(counterField(0)) // true`
    },
    FIELD_BUILDER: {
      role: 'constant',
      purpose: t(
        'Brand symbol a custom field builder sets to `true` so stores recognise it.',
        '自定义字段构建器需设置为 `true` 的品牌 symbol，Store 据此识别它。'
      ),
      example: `const builder = { [FIELD_BUILDER]: true, mode: 'sync', create: (context) => createField(context) }`
    },
    StoreFieldMode: {
      role: 'constant',
      purpose: t(
        'Allowed `mode` values of field builders: `sync` or `async`.',
        '自定义字段构建器 `mode` 字段的允许取值：同步 `sync` 或异步 `async`。'
      ),
      example: `const builder = { [FIELD_BUILDER]: true, mode: StoreFieldMode.sync, create }`
    },
    createStoreResource: {
      role: 'factory',
      purpose: t(
        'Creates a Suspense-safe async value: `read()` returns the value, throws the pending Promise while loading and the error after failure; holders (leases) keep values alive, and old versions stay readable during reloads.',
        '创建可安全配合 Suspense 的异步值：`read()` 返回值，加载中抛出等待中的 Promise，失败后抛出错误；持有者（租约）保持值存活，重新加载期间旧版本仍可读取。'
      ),
      params: {
        factory: t(
          '`({ signal, generation, token }) => value | Promise`, or `{ load, ...options }`; `signal` aborts when the load is replaced or the resource closes.',
          '`({ signal, generation, token }) => value | Promise`，或 `{ load, ...options }`；加载被替换或资源关闭时 `signal` 中止。'
        ),
        options: t(
          '`IStoreResourceOptions`: `keepAliveMs`, `dispose`, `onError`, `onTerminal`, `runtime`, `scheduler`.',
          '资源选项 `IStoreResourceOptions`：`keepAliveMs`、`dispose`、`onError`、`onTerminal`、`runtime`、`scheduler`。'
        )
      },
      returns: t(
        'An `IStoreResource`; invalid options throw `INVALID_OPTION`.',
        '一个 `IStoreResource`；选项不合法时抛 `INVALID_OPTION`。'
      ),
      options: 'IStoreResourceOptions',
      example: resourceExample,
      cases: storeLightCases.createStoreResource,
      scenarios: [
        t(
          'Load data for React Suspense with a cache that survives short unmounts.',
          '为 React Suspense 加载数据，并在短暂卸载期间保留缓存。'
        )
      ]
    },
    createStoreResourceScope: {
      role: 'factory',
      purpose: t(
        'Creates a group of resources released together: `scope.dispose()` force-disposes every resource it created.',
        '创建一组统一释放的资源：`scope.dispose()` 会强制释放它创建的每个资源。'
      ),
      returns: t('An `IStoreResourceScope`.', '一个资源组对象 `IStoreResourceScope`。'),
      example: `const scope = createStoreResourceScope()
const profile = scope.resource(({ signal }) => fetchProfile(signal))
scope.dispose()`
    },
    STORE_LIGHT_SOURCE: {
      role: 'constant',
      purpose: t(
        'The source value for failures owned by this package. Errors already classified by Reactive or Resource retain their actual owner; no blanket source rewrite occurs.',
        '本包拥有的失败所使用的来源值；响应式内核或资源包已分类的错误保留实际所有者，不统一改写来源。'
      ),
      example: `if (error.source === STORE_LIGHT_SOURCE && error.code === StoreLightErrorCode.storeDisposed) return`
    },
    StoreLightErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `if (error.code === StoreLightErrorCode.storeNotReady) await storeReady(store)`
    },
    createStoreLightError: {
      role: 'operation',
      optionDocs: {
        cause: {
          summary: t(
            'Original caller-caught failure passed through native Error options, preserving its identity on the cause chain.',
            '调用方捕获的原始失败，通过原生错误选项传入并在原因链保留身份。'
          ),
          default: t(
            'Omitted: create the error without an explicit original cause.',
            '省略时创建不包含显式原始原因的错误。'
          )
        }
      },
      purpose: t(
        'Creates an `Error` with this package identity, for custom field builders that report in the same format.',
        '创建带本包身份的 `Error`，供想使用相同格式上报的自定义字段构建器使用。'
      ),
      params: {
        code: t('A `StoreLightErrorCode` value.', '一个 `StoreLightErrorCode` 取值。'),
        message: t('Message text.', '错误信息文本。'),
        options: t(
          '`{ cause? }`: the original error kept on `cause`.',
          '可选的 `{ cause? }`：保存在 `cause` 上的原始错误。'
        )
      },
      returns: t('The error, not thrown.', '创建好的错误对象，不会被抛出。'),
      example: `throw createStoreLightError(StoreLightErrorCode.invalidOption, 'bad value')`
    },
    createStoreLightRangeError: {
      role: 'operation',
      purpose: t(
        'Same as `createStoreLightError` but returns a `RangeError`.',
        '与 `createStoreLightError` 相同，但返回带本包身份的 `RangeError`，用于数值越界等情况。'
      ),
      params: {
        code: t('A `StoreLightErrorCode` value.', '一个 `StoreLightErrorCode` 取值。'),
        message: t('Message text.', '错误信息文本。')
      },
      returns: t('The `RangeError`.', '创建好的 `RangeError` 对象。'),
      example: `throw createStoreLightRangeError(StoreLightErrorCode.invalidOption, 'keepAliveMs must be finite')`
    },
    createStoreLightTypeError: {
      role: 'operation',
      optionDocs: {
        cause: {
          summary: t(
            'Original invalid-input failure retained through native TypeError options without replacing its runtime class.',
            '通过原生类型错误选项保留的原始输入失败，不替换运行时错误类型。'
          ),
          default: t(
            'Omitted: create the type error without an explicit original cause.',
            '省略时创建不包含显式原始原因的类型错误。'
          )
        }
      },
      purpose: t(
        'Same as `createStoreLightError` but returns a `TypeError`.',
        '与 `createStoreLightError` 相同，但返回带本包身份的 `TypeError`，用于类型或配置错误。'
      ),
      params: {
        code: t('A `StoreLightErrorCode` value.', '一个 `StoreLightErrorCode` 取值。'),
        message: t('Message text.', '错误信息文本。'),
        options: t(
          '`{ cause? }`: the original error kept on `cause`.',
          '可选的 `{ cause? }`：保存在 `cause` 上的原始错误。'
        )
      },
      returns: t('The `TypeError`.', '创建好的 `TypeError` 对象。'),
      example: `throw createStoreLightTypeError(StoreLightErrorCode.syncFieldRequired, 'use createAsyncStore')`
    },
    createStoreLightAggregateError: {
      role: 'operation',
      purpose: t(
        'Creates an `AggregateError` with this package identity; the given errors stay on `.errors`.',
        '创建带本包 `(source, code)` 身份的 `AggregateError`；传入的各个原始错误都保留在 `.errors` 上。'
      ),
      params: {
        code: t('A `StoreLightErrorCode` value.', '一个 `StoreLightErrorCode` 取值。'),
        errors: t('Errors to combine.', '要合并的错误列表。'),
        message: t('Message text.', '错误信息文本。')
      },
      returns: t('The `AggregateError`.', '创建好的 `AggregateError` 对象。'),
      example: `throw createStoreLightAggregateError(StoreLightErrorCode.initAndCleanupFailed, [initError, cleanupError], 'init failed')`
    }
  },
  types: {
    IReactiveStore: {
      summary: t(
        'A store returned by `createStore` / `createAsyncStore`: your fields and methods plus the `$` API.',
        '`createStore` / `createAsyncStore` 返回的 Store：你定义的字段和方法，外加 `$` 开头的 API。'
      ),
      scenarios: [
        t(
          'Persist settings with `$plain()` and restore them with `$hydrate()`.',
          '用 `$plain()` 持久化设置，并用 `$hydrate()` 恢复。'
        ),
        t(
          'Update several fields in one notification with `$batch()`.',
          '用 `$batch()` 在一次通知中更新多个字段。'
        )
      ],
      example: storeExample,
      members: storeMembers
    },
    IReactiveStoreApi: {
      summary: t('The `$` API every store has.', '每个 Store 都具备的、以 `$` 开头的通用 API。'),
      members: storeMembers
    },
    ICreateStoreOptions: {
      summary: t(
        'Options of `createStore` / `createAsyncStore`.',
        '`createStore` / `createAsyncStore` 的创建选项：运行时、名称与写入策略。'
      ),
      members: {
        runtime: {
          summary: t(
            'Registered createRuntime result from the same owning @migaia/reactive instance, for SSR or application isolation. An arbitrary structural IRuntime object is not supported.',
            '由同一 `@migaia/reactive` 实例的 `createRuntime` 登记创建，用于隔离请求或应用；不支持任意结构相同的运行时对象。'
          ),
          default: t(
            'The shared `defaultRuntime`.',
            '使用共享的 `defaultRuntime`，多个未指定运行时的仓库共用响应式图。'
          )
        },
        debugName: {
          summary: t(
            'Prefix of internal node names in diagnostics.',
            '诊断信息中内部节点名称的前缀。'
          ),
          default: t('`Store`.', '默认值为 `Store`。')
        },
        warnAsyncActions: {
          summary: t(
            'Report `ACTION_BATCH_BOUNDARY` the first time an action returns a Promise: only writes before its first `await` are batched.',
            'action 第一次返回 Promise 时上报 `ACTION_BATCH_BOUNDARY`：只有第一个 `await` 之前的写入会被批量。'
          ),
          default: t('`false`.', '`false`：不提示异步动作的批量更新边界。')
        },
        mutationPolicy: {
          summary: t(
            'Strict write policy (e.g. `createMutationPolicy("actions-only")` from `@migaia/store-middleware`): direct field writes outside actions throw.',
            '严格写入策略（例如 `@migaia/store-middleware` 的 `createMutationPolicy("actions-only")`）：在 action 之外直接写字段会抛错。'
          ),
          default: t('Not set: direct writes are allowed.', '不设置：允许直接写入字段。')
        }
      }
    },
    IHydrateOptions: {
      summary: t('Options of `$hydrate()`.', '`$hydrate()` 的选项：如何处理未知字段。'),
      members: {
        unknown: {
          summary: t(
            'What to do with keys that are not plain fields.',
            '遇到不是普通字段的 key 时如何处理。'
          ),
          default: t('`ignore`.', '`ignore`：忽略未知 key。'),
          values: {
            ignore: t('Skip unknown keys silently.', '静默跳过未知的 key。'),
            report: t(
              'Call `onUnknown(key)` for each unknown key.',
              '对每个未知 key 调用 `onUnknown(key)`。'
            ),
            strict: t(
              'Throw `INVALID_OPTION` before writing anything.',
              '在写入任何字段之前抛 `INVALID_OPTION`。'
            )
          }
        },
        onUnknown: {
          summary: t(
            'Receives each unknown key with `unknown: "report"`.',
            '在 `unknown: "report"` 时逐个接收未知字段的 key。'
          ),
          default: t('Not set.', '不设置：不做回调。')
        }
      }
    },
    ISubscribeOptions: {
      summary: t('Options of `$subscribe()`.', '`$subscribe()` 的选项：是否立即触发一次。'),
      members: {
        fireImmediately: {
          summary: t(
            'Call the callback once right after subscribing.',
            '订阅之后立即调用一次回调。'
          ),
          default: t('`false`.', '`false`：只在变化时调用。')
        }
      }
    },
    IRaw: {
      summary: t('Wrapper returned by `raw(value)`.', '调用 `raw(value)` 返回的原样值包装对象。'),
      scenarios: [
        t(
          'Keep a callback in a store as a replaceable value.',
          '把回调函数作为可替换的值保存在 Store 中。'
        )
      ],
      example: `const form = createStore({ onSubmit: raw((data: FormData) => submit(data)) })`,
      members: {
        value: { summary: t('The wrapped value, stored as is.', '被包装、按原样保存的值。') }
      }
    },
    IStoreDefinition: alias(
      'Object literal accepted by `createStore`.',
      '`createStore` 接受的对象字面量定义。'
    ),
    IStoreShape: alias('Type of the fields a store exposes.', 'Store 对外暴露的全部字段类型。'),
    IWritableStorePatch: alias(
      'Partial object of writable fields accepted by `$set`.',
      '`$set` 接受的可写字段部分对象。'
    ),
    IFieldBuilder: alias(
      'Union of explicit sync and async field builders; a missing mode has no compatibility path.',
      '显式同步或异步字段构建器的联合，不保留无模式的兼容路径。'
    ),
    ISyncFieldBuilder: {
      summary: t(
        'Field builder created synchronously during `createStore`.',
        '在 `createStore` 期间同步创建的字段构建器。'
      ),
      members: {
        mode: {
          summary: t(
            'Always `sync`: the field is created synchronously.',
            '固定为 `sync`，表示同步创建字段。'
          ),
          values: { enum: 'StoreFieldMode' }
        },
        create: {
          summary: t('Creates the field object synchronously.', '同步创建字段对象并返回。'),
          params: {
            context: t(
              '`{ runtime, signal, createSource }`.',
              '字段上下文 `{ runtime, signal, createSource }`。'
            )
          },
          returns: t('The field (an `IDisposable`).', '字段对象（一个 `IDisposable`）。')
        }
      }
    },
    IAsyncFieldBuilder: {
      summary: t(
        'Field builder created asynchronously; needs `createAsyncStore`.',
        '异步创建的字段构建器；需要使用 `createAsyncStore`。'
      ),
      members: {
        mode: {
          summary: t(
            'Always `async`: the field is created asynchronously.',
            '固定为 `async`，表示异步创建字段。'
          ),
          values: { enum: 'StoreFieldMode' }
        },
        create: {
          summary: t('Creates the field asynchronously.', '异步创建并返回字段对象。'),
          params: {
            context: t(
              '`{ runtime, signal, createSource }`; `signal` aborts if the store is disposed meanwhile.',
              '`{ runtime, signal, createSource }`；期间 Store 被释放时 `signal` 中止。'
            )
          },
          returns: t('A Promise of the field.', '字段对象的 Promise。')
        }
      }
    },
    IFieldContext: {
      summary: t(
        'Argument of `create()` in a field builder.',
        '字段构建器 `create()` 收到的上下文。'
      ),
      members: {
        runtime: {
          summary: t(
            'Runtime of the store, for creating nodes.',
            'Store 所在的运行时，用于创建节点。'
          )
        },
        signal: {
          summary: t(
            'Aborts pending initialisation when the store is disposed.',
            'Store 被释放时中止进行中的初始化。'
          )
        },
        createSource: {
          summary: t(
            'Creates a reactive source for custom storage in the same dependency graph.',
            '为自定义存储创建同一依赖图中的响应式来源。'
          ),
          params: { debugName: t('Name in diagnostics.', '诊断信息中显示的名称。') },
          returns: t('An `IFieldSource`.', '一个响应式来源 `IFieldSource`。')
        }
      }
    },
    IFieldSource: {
      summary: t('Reactive source of a custom field.', '自定义字段使用的响应式来源。'),
      members: {
        track: {
          summary: t(
            'Records a read so the current computed or effect depends on the field.',
            '记录一次读取，使当前的计算值或 effect 依赖该字段。'
          ),
          returns: t('Nothing; the dependency is recorded.', '无返回值；依赖已记录。')
        },
        notify: {
          summary: t('Tells dependants the field changed.', '通知依赖方该字段已变化。'),
          returns: t('Nothing; dependants are notified.', '无返回值；依赖方已收到通知。')
        },
        commit: {
          summary: t(
            'Reserves a version, runs `write`, then publishes once (no torn reads).',
            '先预留版本号，执行 `write`，再一次性发布（避免读到中间状态）。'
          ),
          params: {
            write: t('Function that mutates the external storage.', '修改外部存储的函数。')
          },
          returns: t('The value returned by `write`.', '`write` 的返回值。')
        },
        observed: {
          summary: t(
            '`true` while someone depends on the field.',
            '有计算值或 effect 依赖该字段时为 `true`。'
          )
        }
      }
    },
    IMutationGuard: {
      summary: t(
        'Protocol that answers whether a write is allowed now.',
        '回答“当前是否允许写入”的协议。'
      ),
      members: {
        assertMutationAllowed: {
          summary: t('Throws when a write is not allowed now.', '当前不允许写入时抛错。'),
          params: {
            operation: t(
              'Description of the write, such as `set(count)`.',
              '写入操作的描述，例如 `set(count)`。'
            )
          },
          returns: t('Nothing when allowed.', '允许写入时无返回值。')
        }
      }
    },
    IMutationPolicy: {
      summary: t(
        'Write guard that can also mark code as running inside an action.',
        '写入守卫，并能把代码标记为在 action 内运行。'
      ),
      members: {
        runInAction: {
          summary: t(
            'Runs `fn` as an action, allowing writes inside it.',
            '以 action 的身份运行 `fn`，其中的写入会被允许。'
          ),
          params: { fn: t('Function to run.', '要在 action 中运行的函数。') },
          returns: t('The result of `fn`.', '`fn` 的返回结果。')
        },
        assertMutationAllowed: {
          summary: t(
            'Throws when a write happens outside an action.',
            '在 action 之外发生写入时抛错。'
          ),
          params: {
            operation: t('Description of the write.', '写入操作的描述，例如 `set(count)`。')
          },
          returns: t('Nothing when allowed.', '允许写入时无返回值。')
        }
      }
    },
    IStoreResource: {
      summary: t(
        'Async value container returned by `createStoreResource()`.',
        '`createStoreResource()` 返回的、可配合 Suspense 的异步值容器。'
      ),
      scenarios: [
        t(
          'Suspend a React component until data loads, then keep it cached.',
          '让 React 组件挂起直到数据加载完成，然后保持缓存。'
        ),
        t(
          'Reload data in the background while the old value stays on screen.',
          '在后台重新加载数据，同时旧值仍显示在界面上。'
        )
      ],
      example: resourceExample,
      members: {
        read: {
          summary: t(
            'Returns the current value; throws the pending Promise while loading and the error after failure (Suspense protocol).',
            '返回当前值；加载中抛出等待中的 Promise，失败后抛出错误（Suspense 协议）。'
          ),
          returns: t('The value.', '资源当前的值。'),
          example: `const user = userResource.read()`
        },
        preload: {
          summary: t(
            'Starts loading if it has not started; takes no lease.',
            '尚未开始时触发加载；不会建立持有租约。'
          ),
          returns: t('Nothing; loading started.', '无返回值；加载已开始。'),
          example: `userResource.preload()`
        },
        retry: {
          summary: t(
            'Marks the value stale and reloads; the old value stays readable until the new one arrives.',
            '把当前值标记为过期并重新加载；新值到达前旧值仍可读取。'
          ),
          returns: t('Nothing; a reload started.', '无返回值；重新加载已开始。'),
          example: `userResource.retry()`
        },
        retainResource: {
          summary: t(
            'Takes a lease on the resource so it is not evicted by `keepAliveMs`.',
            '获取资源级租约，使其不会因 `keepAliveMs` 到期而被逐出。'
          ),
          returns: t('A release function.', '释放该租约的函数。'),
          example: `const release = userResource.retainResource()`
        },
        retainVersion: {
          summary: t(
            'Keeps one existing visible, stale or retained version alive after retry. An evicted version cannot be revived and throws UNKNOWN_VERSION.',
            '在重新加载后保持某个现存可见、过期或已持有版本；已逐出的版本不能复活，会抛 `UNKNOWN_VERSION`。'
          ),
          params: {
            version: t(
              'Version number or token read from `readSnapshot()`.',
              '从 `readSnapshot()` 读到的版本号或版本令牌。'
            )
          },
          returns: t('A release function.', '释放该版本租约的函数。'),
          example: `const release = userResource.retainVersion(userResource.readSnapshot().version)`
        },
        captureVersion: {
          summary: t(
            'Render phase: directly captures an existing version without an expiry timer. Only pending captures resolved to a version receive the 4000 ms provisional window. Evicted versions throw UNKNOWN_VERSION.',
            '渲染阶段直接捕获现存版本，不设置到期计时器；仅从等待中加载解析出的临时捕获使用 4000 毫秒窗口。已逐出版本抛 `UNKNOWN_VERSION`。'
          ),
          params: {
            version: t(
              'Version number from `readSnapshot()`.',
              '从 `readSnapshot()` 读到的版本号。'
            )
          },
          returns: t('An `IResourceCapture` token.', '一个捕获令牌 `IResourceCapture`。'),
          example: `const capture = userResource.captureVersion(snapshot.version)`
        },
        commitCapture: {
          summary: t(
            'Commit phase: turns a capture into a version lease.',
            '提交阶段：把捕获转换为正式的版本租约。'
          ),
          params: {
            capture: t(
              'Token from `captureVersion()`, usable once.',
              '由 `captureVersion()` 返回的令牌，只能使用一次。'
            )
          },
          returns: t(
            'A release function; an invalid token throws `CAPTURE_INVALID`.',
            '释放函数；令牌无效时抛 `CAPTURE_INVALID`。'
          ),
          example: `const release = userResource.commitCapture(capture)`
        },
        dispose: {
          summary: t(
            'Graceful release: with holders it waits in `closing` until the last lease is released.',
            '优雅释放：仍有持有者时进入 `closing`，等最后一个租约释放后才结束。'
          ),
          returns: t('Nothing; release started.', '无返回值；释放已开始。'),
          example: `userResource.dispose()`
        },
        forceDispose: {
          summary: t(
            'Ends logical ownership immediately, ignoring holders; asynchronous physical cleanup can remain pending.',
            '无视持有者立即结束逻辑所有权；异步物理清理仍可能等待完成。'
          ),
          returns: t('Nothing; the resource is disposed.', '无返回值；资源已释放。'),
          example: `userResource.forceDispose()`
        },
        whenTerminal: {
          summary: t(
            'Resolves after logical disposal and all registered asynchronous physical cleanup settle; does not depend on garbage collection. Cleanup failures are reported rather than replacing completion.',
            '在逻辑释放且已登记异步物理清理结束后完成，不依赖垃圾回收；清理失败经报告通道处理，不替换完成结果。'
          ),
          returns: t('A Promise resolved at termination.', '在终止时 resolve 的 Promise。'),
          example: `await userResource.whenTerminal()`
        },
        subscribe: {
          summary: t(
            'Listens for state changes; pair with `getSnapshot()` for `useSyncExternalStore`.',
            '监听状态变化；与 `getSnapshot()` 配合可用于 `useSyncExternalStore`。'
          ),
          params: { listener: t('Called on every change.', '每次状态变化时调用的函数。') },
          returns: t('An unsubscribe function.', '取消订阅的函数。'),
          example: `useSyncExternalStore(userResource.subscribe, userResource.getSnapshot)`
        },
        getSnapshot: {
          summary: t(
            'Returns a revision number that grows on every change.',
            '返回每次变化都会递增的修订号。'
          ),
          returns: t('The revision number.', '当前的修订号。'),
          example: `userResource.getSnapshot()`
        },
        readSnapshot: {
          summary: t(
            'Like `read()` but also returns `version` and `token`.',
            '与 `read()` 相同，但同时返回版本号 `version` 与版本令牌 `token`。'
          ),
          returns: t('`{ value, version, token }`.', '`{ value, version, token }` 快照对象。'),
          example: `const { value, version } = userResource.readSnapshot()`
        },
        captureSnapshot: {
          summary: t(
            'Reads a snapshot and captures its version in one step (used by `useStoreResource`).',
            '一步完成读取快照并捕获其版本（`useStoreResource` 使用）。'
          ),
          params: {
            existingLease: t(
              'Release function returned earlier by `commitCapture()`, to skip a second capture.',
              '之前由 `commitCapture()` 返回的释放函数，用于跳过重复捕获。'
            )
          },
          returns: t('`{ snapshot, capture? }`.', '`{ snapshot, capture? }` 结果对象。'),
          example: `const { snapshot, capture } = userResource.captureSnapshot()`
        }
      }
    },
    IStoreResourceScope: {
      summary: t(
        'Group of resources returned by `createStoreResourceScope()`.',
        '`createStoreResourceScope()` 返回的、统一释放的资源组。'
      ),
      scenarios: [
        t(
          'Release every resource of a page or request at once.',
          '一次性释放某个页面或请求的全部资源。'
        )
      ],
      example: `const scope = createStoreResourceScope()
const user = scope.resource(({ signal }) => fetchUser(signal))
scope.dispose()`,
      members: {
        resource: {
          summary: t(
            'Creates a resource in this group (same arguments as `createStoreResource`).',
            '在该组中创建资源（参数与 `createStoreResource` 相同）。'
          ),
          params: {
            factory: t('Loader or `{ load, ...options }`.', '加载函数或 `{ load, ...options }`。'),
            options: t('`IStoreResourceOptions`.', '资源选项 `IStoreResourceOptions`。')
          },
          returns: t('An `IStoreResource`.', '一个异步值容器 `IStoreResource`。'),
          example: `const settings = scope.resource(({ signal }) => fetchSettings(signal))`
        },
        dispose: {
          summary: t(
            'Force-disposes every live resource of the group.',
            '强制释放该组中所有仍存活的资源。'
          ),
          returns: t('Nothing; the group is released.', '无返回值；整组资源已释放。'),
          example: `scope.dispose()`
        }
      }
    },
    IStoreResourceOptions: {
      summary: t(
        'Options of `createStoreResource()`.',
        '`createStoreResource()` 的选项：缓存、清理与上报。'
      ),
      members: resourceOptionFields
    },
    IStoreResourceConfig: {
      summary: t(
        'Object form `{ load, ...options }` of the first argument.',
        '第一个参数的对象形式 `{ load, ...options }`。'
      ),
      members: {
        load: {
          summary: t(
            'The loader `({ signal, generation, token }) => value | Promise`.',
            '负责取得值的加载函数 `({ signal, generation, token }) => value | Promise`。'
          )
        },
        ...resourceOptionFields
      }
    },
    IStoreResourceErrorPhase: {
      summary: t('Phases reported to `onError`.', '传给 `onError` 回调的失败阶段取值。'),
      members: {
        load: {
          summary: t(
            '`load`: loading or validating a value failed.',
            '`load`：加载或校验值的过程中失败。'
          )
        },
        dispose: {
          summary: t(
            '`dispose`: releasing a value failed.',
            '`dispose`：释放某个已加载的值时失败。'
          )
        },
        listener: {
          summary: t('`listener`: a subscriber threw.', '`listener`：某个订阅者抛出了错误。')
        }
      }
    },
    IStoreResourceFactory: alias(
      'Loader `(context) => value | Promise` of a resource.',
      '资源容器使用的加载函数 `(context) => value | Promise`。'
    ),
    IStoreResourceLoadContext: alias(
      'Argument of the loader: `{ signal, generation, token }`.',
      '加载函数收到的上下文参数：`{ signal, generation, token }`。'
    ),
    IResourceCapture: alias(
      'Token returned by `captureVersion()` and consumed by `commitCapture()`.',
      '由 `captureVersion()` 返回、并被 `commitCapture()` 消费的一次性令牌。'
    ),
    IStoreFieldMode: alias(
      'Union of `StoreFieldMode` values.',
      '`StoreFieldMode` 全部取值组成的联合类型。'
    ),
    IStoreLightErrorCode: alias(
      'Union of `StoreLightErrorCode` values.',
      '`StoreLightErrorCode` 全部取值组成的联合类型。'
    )
  },
  enums: {
    StoreFieldMode: {
      summary: t('`mode` of a field builder.', '字段构建器的 `mode` 取值，决定创建方式。'),
      values: {
        sync: t(
          '`sync`: created during `createStore`, usable at once.',
          '`sync`：在 `createStore` 期间创建，构造完成即可使用。'
        ),
        async: t(
          '`async`: created asynchronously; needs `createAsyncStore`.',
          '`async`：异步创建字段；必须使用 `createAsyncStore`。'
        )
      }
    },
    StoreLightErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/store-light`.',
        '`@migaia/store-light` 的稳定错误码及处理方式。'
      ),
      values: {
        storeDisposed: t(
          '`STORE_DISPOSED`: the store was used after `$dispose()`; create a new store.',
          '`STORE_DISPOSED`：在 `$dispose()` 之后使用了 Store；需要创建新的 Store。'
        ),
        resourceDisposed: t(
          '`RESOURCE_DISPOSED`: the resource is closing or disposed; stop using it.',
          '`RESOURCE_DISPOSED`：资源正在关闭或已释放；停止使用它。'
        ),
        captureInvalid: t(
          '`CAPTURE_INVALID`: the capture token is invalid or already used.',
          '`CAPTURE_INVALID`：捕获令牌无效或已被使用过。'
        ),
        unknownVersion: t(
          'UNKNOWN_VERSION: the version is unknown or already evicted; retaining or capturing it cannot revive it. Read a current snapshot instead.',
          '`UNKNOWN_VERSION`：版本未知或已逐出，重新持有或捕获不能复活它；应读取当前快照。'
        ),
        identityRequired: t(
          '`IDENTITY_REQUIRED`: a resource with `dispose` returned a primitive value.',
          '`IDENTITY_REQUIRED`：带 `dispose` 的资源返回了原始类型的值。'
        ),
        noAsyncInit: t(
          'NO_ASYNC_INIT: storeReady received an object without readiness registered by this package instance. Both synchronous and asynchronous stores created here are registered.',
          '`NO_ASYNC_INIT`：`storeReady` 收到未由本包实例登记就绪状态的对象；本实例创建的同步与异步仓库均已登记。'
        ),
        storeNotReady: t(
          '`STORE_NOT_READY`: async fields read before the store was ready; await `storeReady()`.',
          '`STORE_NOT_READY`：在 Store 就绪前读取了异步字段；请先等待 `storeReady()`。'
        ),
        initAndCleanupFailed: t(
          'INIT_AND_CLEANUP_FAILED: initialization and cleanup both fail and cleanup cannot attach to the primary Error. Aggregate errors retain the original first; writable primary errors retain identity and receive cleanup through cause instead.',
          '`INIT_AND_CLEANUP_FAILED`：初始化和清理均失败，且无法把清理失败附到主错误；聚合列表保留原错在先，可写主错误则保留身份并经原因链附清理失败。'
        ),
        fieldDisposeFailed: t(
          'FIELD_DISPOSE_FAILED: a late field disposer throws or rejects after initialization is abandoned or the store closes. The Runtime reports the original native error or a coded fallback retaining it.',
          '`FIELD_DISPOSE_FAILED`：初始化放弃或仓库关闭后，晚到字段清理同步抛错或异步拒绝；运行时报告原生原错，或经带码回退保留它。'
        ),
        initializationFailed: t(
          'INITIALIZATION_FAILED: an unclassified field initialization fails; native mutable errors retain identity and stack, while fallback errors retain the original cause. Already classified foreign errors retain their owner.',
          '`INITIALIZATION_FAILED`：未分类字段初始化失败；可修改原生错误保留身份与堆栈，回退错误保留原始原因；外包已分类错误保留实际所有者。'
        ),
        syncFieldRequired: t(
          '`SYNC_FIELD_REQUIRED`: an async field builder was passed to `createStore`.',
          '`SYNC_FIELD_REQUIRED`：把异步字段构建器传给了 `createStore`。'
        ),
        actionBatchBoundary: t(
          '`ACTION_BATCH_BOUNDARY`: diagnostic; writes after `await` in an action are not batched.',
          '`ACTION_BATCH_BOUNDARY`：诊断提示；action 中 `await` 之后的写入不会被批量。'
        ),
        envUnsupported: t(
          '`ENV_UNSUPPORTED`: the host lacks `WeakRef` or `FinalizationRegistry`.',
          '`ENV_UNSUPPORTED`：宿主环境缺少所需的 `WeakRef` 或 `FinalizationRegistry` 能力。'
        ),
        invalidOption: t(
          'INVALID_OPTION: an option, reserved built-in API key, $set target or $hydrate field is invalid; correct the named input.',
          '`INVALID_OPTION`：选项、内置接口保留键、`$set` 目标或 `$hydrate` 字段不合法，应修正指明的输入。'
        )
      }
    }
  },
  enhancers: {}
}
