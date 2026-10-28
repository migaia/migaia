import initWasm, { alloc_bytes, dealloc_bytes, ptr_of } from '@migaia/wasm'
import {
  createStoreWasmAggregateError,
  createStoreWasmError,
  createStoreWasmRangeError,
  StoreWasmErrorCode
} from './errors.ts'
import { StoreWasmErrorText } from './error-text.ts'
import { attachSecondaryErrors } from '@migaia/utils/error'

// 模块作用域缓存，只发起一次加载；重复调用（StrictMode 双渲染、父组件无关重渲染）拿到同一个 promise 引用，
// 不会重复 fetch/instantiate，也不会导致 use() 每次渲染都重新挂起
let wasmReady: Promise<WebAssembly.Memory> | undefined
let wasmMemory: WebAssembly.Memory | undefined
/**
 * Initialize the shared WASM module and return its Memory, sharing the exact pending/successful
 * Promise across calls. Await before creating a Store containing these synchronous fields, or pass
 * this factory to a Provider readiness barrier. A failed attempt clears the initialization cache
 * for retry; native loading/trap errors retain their identity rather than receiving a Store code.
 * This does not allocate a field or provide an instance-reset/disposal API.
 */
export function ensureWasm(): Promise<WebAssembly.Memory> {
  // Keep the settled promise identity as well as the memory value. A ready
  // barrier is a generation token for React/SSR callers; wrapping the value
  // in Promise.resolve() on each call would create a new generation forever.
  if (wasmReady) return wasmReady
  const pending = initWasm().then((o) => (wasmMemory = o.memory))
  wasmReady = pending
  pending.catch(() => {
    if (wasmReady === pending) wasmReady = undefined
  })
  return pending
}
const MAX_WASM32_ALLOCATION = 0xffff_ffff

/**
 * First `WebAssembly.RuntimeError` raised by an arena export of the shared `@migaia/wasm` instance,
 * or `undefined` while the instance is healthy. A trap can leave the Rust arena borrow held, so
 * every later export would trap again; wasm-bindgen keeps one instance per module, so it cannot be
 * rebuilt either. Once set, allocation fails with `INSTANCE_POISONED` (cause: this trap) and
 * release becomes a no-op.
 */
let poisonedBy: WebAssembly.RuntimeError | undefined

/**
 * Runs one arena export and poisons the shared instance when it traps. The trap itself is rethrown
 * unchanged so the first caller still sees the native error.
 */
function callArena<T>(call: () => T): T {
  try {
    return call()
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) poisonedBy ??= error
    throw error
  }
}

/** Rejects allocation on a poisoned instance before any export is called. */
function assertNotPoisoned(): void {
  if (poisonedBy === undefined) return
  throw createStoreWasmError(
    StoreWasmErrorCode.instancePoisoned,
    StoreWasmErrorText.instancePoisoned,
    { cause: poisonedBy }
  )
}

// GC 兜底：字段对象没人引用且未显式 dispose 时，自动释放对应分配。
// 显式 dispose 是主路径（确定性、可预期时机）；此 registry 仅兜底。dispose 时会 unregister，避免重复释放。
const finalizer =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<number>((id) => deallocate(id))
    : undefined

/** GC fallback is optional; explicit field disposal remains the portable path. */
export const registry = {
  register(target: object, id: number, unregisterToken?: object): void {
    finalizer?.register(target, id, unregisterToken)
  },
  unregister(unregisterToken: object): boolean {
    return finalizer?.unregister(unregisterToken) ?? false
  }
}

/**
 * Explicitly frees an allocation during field disposal. `dealloc_bytes` ignores unknown IDs, so
 * repeated release is safe. On a poisoned instance the arena can no longer free anything, so
 * release is a no-op instead of a second trap; allocation keeps reporting the poisoning.
 */
export function deallocate(id: number): void {
  if (poisonedBy !== undefined) return
  callArena(() => dealloc_bytes(id))
}

/** Runs every cleanup action and preserves all failures for the caller. */
export function disposeAllWasm(cleanups: ReadonlyArray<() => void>): void {
  const errors: unknown[] = []
  for (const cleanup of cleanups) {
    try {
      cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw createStoreWasmAggregateError(
      StoreWasmErrorCode.cleanupFailed,
      errors,
      StoreWasmErrorText.cleanupFailed
    )
  }
}

/** Disposes one registered field in ownership order: unregister, source, then native block. */
export function disposeWasmField(
  block: IWasmAllocation,
  field: object,
  sources: readonly { dispose(): void }[]
): void {
  block.unregister(field)
  disposeAllWasm([...sources.map((source) => () => source.dispose()), () => block.dispose()])
}

/**
 * Re-throws the construction primary with the rollback failure appended to its non-enumerable
 * `errors`. Primitive, frozen or hostile primaries fall back to a coded aggregate whose first entry
 * is the primary, so both failures stay reachable.
 */
export function throwWasmConstructionFailure(primary: unknown, cleanup: unknown): never {
  if (attachSecondaryErrors(primary, [cleanup]) === primary) throw primary
  throw createStoreWasmAggregateError(
    StoreWasmErrorCode.cleanupFailed,
    [primary, cleanup],
    StoreWasmErrorText.cleanupFailed
  )
}

/** One owned allocation with a single explicit/GC cleanup boundary. */
export type IWasmAllocation = {
  readonly memory: WebAssembly.Memory
  readonly id: number
  readonly ptr: number
  register(target: object): void
  unregister(target: object): void
  dispose(): void
}

function allocation(memory: WebAssembly.Memory, id: number, ptr: number): IWasmAllocation {
  let disposed = false
  return {
    memory,
    id,
    ptr,
    register(target) {
      registry.register(target, id, target)
    },
    unregister(target) {
      registry.unregister(target)
    },
    dispose() {
      if (disposed) return
      deallocate(id)
      disposed = true
    }
  }
}

/** Completes the allocator handshake and rolls back an id when its pointer is unusable. */
function completeAllocation(
  memory: WebAssembly.Memory,
  id: number
): {
  memory: WebAssembly.Memory
  id: number
  ptr: number
} {
  let ptr: number
  try {
    ptr = callArena(() => ptr_of(id))
  } catch (primary) {
    try {
      if (id !== 0) deallocate(id)
    } catch (cleanup) {
      throwWasmConstructionFailure(primary, cleanup)
    }
    throw primary
  }
  if (id !== 0 && ptr !== 0) return { memory, id, ptr }

  const primary = createStoreWasmError(
    StoreWasmErrorCode.allocationFailed,
    StoreWasmErrorText.allocationFailed
  )
  try {
    if (id !== 0) deallocate(id)
  } catch (cleanup) {
    throwWasmConstructionFailure(primary, cleanup)
  }
  throw primary
}

/** Allocate and own a field-sized block after explicit WASM initialization. */
export function allocateOwnedSync(byteLen: number): IWasmAllocation {
  const result = allocateSync(byteLen)
  return allocation(result.memory, result.id, result.ptr)
}

/** Allocate after explicit WASM initialization; never starts async work. */
export function allocateSync(byteLen: number) {
  if (!Number.isSafeInteger(byteLen) || byteLen < 0 || byteLen > MAX_WASM32_ALLOCATION) {
    throw createStoreWasmRangeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.allocationLimit
    )
  }
  const memory = wasmMemory
  if (!memory)
    throw createStoreWasmError(StoreWasmErrorCode.notInitialized, StoreWasmErrorText.notInitialized)
  assertNotPoisoned()
  const id = callArena(() => alloc_bytes(byteLen))
  return completeAllocation(memory, id)
}
