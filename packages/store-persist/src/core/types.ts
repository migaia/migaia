import type { IComputedValue, IDisposer, IRuntime } from '@migaia/reactive'
import type { ICodec, IKeyValueStore, IRecordStore } from '@migaia/storage-contract'
import { PersistState } from '../state-constants.js'

/**
 * 任意持久化单位的最小能力面：同步读快照、同步写回、订阅变化。
 *
 * `persist()`（store-light）、`persistCollection()`（store-indexed）、以及 `persistKeyed()` 内部为每个 key
 * 各自创建的持久化单位，全部实现这同一个接口——`persistUnit()` 只写一遍。
 */
export type IPersistUnit<TState> = {
  /** 同步读当前可持久化状态。 */
  snapshot(): TState
  /** 同步写回一份状态（hydrate 用）。 */
  restore(state: TState): void
  /** 注册变化通知，返回取消订阅函数。 */
  subscribe(onChange: () => void): IDisposer
}

export type IPersistStatus =
  | typeof PersistState.loading
  | typeof PersistState.ready
  | typeof PersistState.error
  | typeof PersistState.disposed
export type IHydrationStatus =
  | typeof PersistState.loading
  | typeof PersistState.success
  | typeof PersistState.error
export type IWriteStatus =
  | typeof PersistState.idle
  | typeof PersistState.writing
  | typeof PersistState.error
  | typeof PersistState.disposed

export type IReadonlyPersistValue<T> = {
  readonly value: T
}

export type IPersistHandle = {
  status: IComputedValue<IPersistStatus>
  error: IComputedValue<unknown>
  hydrated: IComputedValue<boolean>
  hydrationStatus: IReadonlyPersistValue<IHydrationStatus>
  hydrationError: IReadonlyPersistValue<unknown>
  writeStatus: IReadonlyPersistValue<IWriteStatus>
  writeError: IReadonlyPersistValue<unknown>
  /** Hydration 成功 resolve；失败 reject。 */
  ready: Promise<void>
  /** Hydration 成功或失败都 resolve。 */
  settled: Promise<void>
  /** 立即写并等待全部在途写入完成；期间 dispose 会以 AbortError 结束。 */
  flush(): Promise<void>
  /** 排队删除存档；期间 dispose 会以 AbortError 结束。 */
  clear(): Promise<void>
  readonly disposed: boolean
  dispose(): void
}

export type IPersistUnitOptions<TState> = {
  key: string
  /** 状态信号挂在哪个 Runtime 上——通常传底层 store/collection/AtomStore 自己的 runtime，保证同一张图。 */
  runtime: IRuntime
  storage: IPersistStorage
  /** Codec 编解码的是整份 envelope（`{ version, state }`），天然是类型擦除的，不按 TState 参数化。 */
  codec?: ICodec
  version?: number
  migrate?: (persisted: TState, fromVersion: number) => TState
  partialize?: (state: TState) => Partial<TState>
  merge?: (persisted: Partial<TState>, current: TState) => TState
  debounceMs?: number
}

/**
 * Store-persist 需要的存储能力投影：字段全部 `Pick` 自 storage-web canonical 类型，不手写方法签名。 仅 store-persist
 * 内部存在，不作为公开 contract 导出；text-only adapter 只需 `capabilities`/`get`/`set`/ `remove`/`keys`（无需
 * `backend`/`has`/`clearValues`/`clearAll`/`dispose`）。字节通道可选，投影自 `IRecordStore`。
 */
export type IPersistStorage = Pick<
  IKeyValueStore,
  'capabilities' | 'get' | 'set' | 'remove' | 'keys'
> & {
  readonly getBytes?: IRecordStore['getBytes']
  readonly setBytes?: IRecordStore['setBytes']
}

/** Binary 分支用内部 guard 收窄到具备字节通道的 storage。 */
export type IPersistByteStorage = IPersistStorage &
  Required<Pick<IPersistStorage, 'getBytes' | 'setBytes'>>
