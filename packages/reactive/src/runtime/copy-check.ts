/**
 * 双实例自检。
 *
 * 本库的几处关键状态是**模块级**的：所有权表 `OWNERS`、内部面表 `INTERNALS`、 以及同步追踪上下文
 * `activeTracker`。它们是正确性的支点，前提是「整个进程里只有 一份这个模块」。
 *
 * 这个前提会被打破，而且打破得很安静：重复安装（两个版本的依赖各带一份）、 打包产物与 CDN 副本共存、微前端各自打包同一个库。此时：
 *
 * - 两份 `OWNERS`：A 副本创建的节点在 B 副本眼里「不是本库创建的 Runtime」， 报错信息却只说「这不是 createRuntime() 造的」——真正的原因看不出来；
 * - 两份 `activeTracker`：跨副本的依赖读取**检测不到**，于是跨 Runtime 读会静默 拿到陈旧数据，恰好是本库明确承诺要拒绝的那件事。
 *
 * 所以要有自检。它不擅自决定「两份就是错的」——微前端里刻意隔离两份是合理的； 它做的是：登记、在出现第二份时讲清后果、并让需要硬失败的应用能显式要求单副本。
 *
 * 登记刻意**不在模块加载时**发生，而在第一次触碰正确性边界时：创建 Runtime、 查询节点归属、或读取 Runtime 内部面。import 内核不该有副作用（那是
 * defaultRuntime 刚修掉的问题）；但只读副本若拿本副本的 `ownerOf` 查询另一副本的 节点，同样已经进入了所有权协议，不能因为它没创建 Runtime 就从计数里消失。
 *
 * 这套 `Symbol.for` 登记是发布产物与第二份消费者副本共存时的基础设施防线； 当前单体源码树不会因此自动产生第二份 Runtime。
 */
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'

/** 跨副本共享的键。函数化避免 import 时连全局 Symbol registry 都被触碰。 */
const registryKey = (): symbol => Symbol.for('@migaia/reactive.runtime-copies')

/** 本副本的身份。每份模块各自新建一个，因此可用来数副本。 */
const THIS_COPY = Symbol('@migaia/reactive.runtime-copy')

/** Versioned process-wide diagnostic record shared by independently loaded library copies. */
type IRegistry = {
  readonly version: 1
  readonly copies: Set<symbol>
  warned: boolean
}

/** Validates data descriptors without invoking hostile registry getters or assuming graph authority. */
function isRegistry(value: unknown): value is IRegistry {
  if (typeof value !== 'object' || value === null) return false
  try {
    /** Reflection inspects registry structure without calling accessor properties. */
    const descriptors = Object.getOwnPropertyDescriptors(value)
    /** Protocol version must be a data property matching the existing registry format. */
    const version = descriptors.version
    /** Copy identities must remain in a native Set shared by this process registry. */
    const copies = descriptors.copies
    /** Warning state must be writable so the second-copy warning is recorded only once. */
    const warned = descriptors.warned
    return (
      version !== undefined &&
      'value' in version &&
      version.value === 1 &&
      copies !== undefined &&
      'value' in copies &&
      copies.value instanceof Set &&
      warned !== undefined &&
      'value' in warned &&
      typeof warned.value === 'boolean' &&
      warned.writable === true
    )
  } catch {
    return false
  }
}

/** 本副本是否已登记。热路径只付一次布尔判断，不反复读 globalThis。 */
let thisCopyNoted = false

/** 惰性读取共享登记表。`create=false` 只观察，绝不因诊断查询制造全局状态。 */
function registryOf(create: false): IRegistry | undefined
function registryOf(create: true): IRegistry
function registryOf(create: boolean): IRegistry | undefined {
  /** The host owns only this diagnostic record; per-copy graph services remain module-private. */
  const host = globalThis as unknown as object
  /** The global symbol is resolved lazily when a correctness boundary is actually entered. */
  const key = registryKey()
  /** An accessor registry cannot impersonate the expected shared data record. */
  const descriptor = Object.getOwnPropertyDescriptor(host, key)
  if (descriptor) {
    /** Retain the reflected value for validation without a second property read. */
    const existing = 'value' in descriptor ? descriptor.value : undefined
    if (!isRegistry(existing)) {
      throw createReactiveError(
        ReactiveErrorCode.copyConflict,
        ReactiveErrorText.copyRegistryInvalid
      )
    }
    return existing as IRegistry
  }
  if (!create) return undefined
  /** First registration publishes one versioned record without creating any Runtime or graph. */
  const created: IRegistry = {
    version: 1,
    copies: new Set(),
    warned: false
  }
  Object.defineProperty(host, key, {
    value: created,
    configurable: true
  })
  return created
}

/** 节点上的跨副本诊断品牌；真正的归属权威仍是每份模块私有的 WeakMap。 */
const ownershipCopyKey = (): symbol => Symbol.for('@migaia/reactive.ownership-copy')

/** Brands objects managed by this library copy immutably so another copy rejects foreign ownership. */
export function brandOwnedValue(value: object): void {
  /** All library copies recognize this brand key while keeping distinct identity values. */
  const key = ownershipCopyKey()
  /** Inspect existing brand descriptors without evaluating consumer-defined accessors. */
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor) {
    if ('value' in descriptor && descriptor.value === THIS_COPY) return
    if ('value' in descriptor && typeof descriptor.value === 'symbol') {
      noteRuntimeCopy(descriptor.value)
      noteRuntimeCopy()
      throw createReactiveError(ReactiveErrorCode.copyConflict, ReactiveErrorText.foreignCopyValue)
    }
    throw createReactiveError(
      ReactiveErrorCode.brandCorrupted,
      ReactiveErrorText.ownershipBrandCorrupted
    )
  }
  Object.defineProperty(value, key, {
    value: THIS_COPY,
    configurable: false,
    enumerable: false,
    writable: false
  })
}

/**
 * Detects managed objects from another copy after a local WeakMap miss instead of accepting them as
 * ordinary values.
 */
export function assertNoForeignOwnershipBrand(value: object): void {
  /** Descriptor-only reads separate plain values from foreign or corrupted managed values. */
  const descriptor = Object.getOwnPropertyDescriptor(value, ownershipCopyKey())
  if (!descriptor) return
  if ('value' in descriptor && descriptor.value === THIS_COPY) return
  if ('value' in descriptor && typeof descriptor.value === 'symbol') {
    noteRuntimeCopy(descriptor.value)
    noteRuntimeCopy()
    throw createReactiveError(
      ReactiveErrorCode.copyConflict,
      ReactiveErrorText.foreignCopyDependency
    )
  }
  throw createReactiveError(
    ReactiveErrorCode.brandCorrupted,
    ReactiveErrorText.ownershipBrandCorrupted
  )
}

/**
 * 待上报的多副本诊断。`noteRuntimeCopy` 可能发生在 Runtime 构造**之前**（`createRuntime` 先登记再 new）， 所以先记录状态，等 Runtime
 * 建立后经其 diagnostic 通道上报；不直接 `console.error`。
 */
let pendingCopyWarning: string | undefined

/** Returns and clears the pending multiple-copy diagnostic. Runtime construction consumes it. */
export const consumePendingCopyWarning = (): string | undefined => {
  /** Clearing before return transfers ownership of this warning to the newly registered Runtime. */
  const warning = pendingCopyWarning
  pendingCopyWarning = undefined
  return warning
}

/**
 * Registers this library copy at `createRuntime()` and ownership or internals boundaries.
 * Registration is idempotent and uses a local fast path.
 *
 * The `copy` parameter lets tests simulate another module copy. Production paths always use this
 * copy's identity.
 */
export function noteRuntimeCopy(copy: symbol = THIS_COPY): void {
  if (copy === THIS_COPY && thisCopyNoted) return
  /** The shared record tracks diagnostics only; copy-local WeakMaps remain graph authorities. */
  const registry = registryOf(true)
  registry.copies.add(copy)
  if (copy === THIS_COPY) thisCopyNoted = true
  if (registry.copies.size > 1 && !registry.warned) {
    registry.warned = true
    pendingCopyWarning = ReactiveErrorText.multipleCopiesWarning
  }
}

/**
 * Returns the number of copies that enter runtime or ownership correctness boundaries. Importing
 * alone does not count.
 */
export const runtimeCopyCount = (): number => registryOf(false)?.copies.size ?? 0

/**
 * Throws unless the process uses a single registered library copy.
 *
 * Applications can choose startup failure over undetected stale data. The library does not call
 * this itself because accepting multiple copies is a deployment decision.
 */
export function assertSingleRuntimeCopy(): void {
  // 调用断言的只读副本也算一份；否则「另一份已登记 + 本副本未建 Runtime」会误判。
  noteRuntimeCopy()
  /** Include this copy before deciding whether the deployment satisfies explicit single-copy policy. */
  const registry = registryOf(true)
  if (registry.copies.size > 1) {
    throw createReactiveError(
      ReactiveErrorCode.copyConflict,
      ReactiveErrorText.expectedSingleCopy(registry.copies.size)
    )
  }
}

/** Clears simulated library copies for tests so cases do not affect each other. */
export function resetRuntimeCopiesForTest(): void {
  Reflect.deleteProperty(globalThis, registryKey())
  thisCopyNoted = false
}
