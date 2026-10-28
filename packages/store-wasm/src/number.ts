import { memoryView } from './memory-view.ts'
import type { IDisposable } from '@migaia/reactive'
import {
  allocateOwnedSync,
  disposeAllWasm,
  disposeWasmField,
  throwWasmConstructionFailure
} from './arena.ts'
import {
  assertWasmFieldNotAborted,
  createStoreWasmError,
  createStoreWasmTypeError,
  StoreWasmErrorCode
} from './errors.ts'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.ts'
import { StoreFieldMode } from '@migaia/store-light'
import { StoreWasmErrorText } from './error-text.ts'

/** Owned f64 field created by the Store field protocol; disposal makes value access terminal. */
export type IWasmNumberField = IDisposable & {
  /** Tracked number, initially 0; accepts every JavaScript number, including NaN and infinities. */
  value: number
  /** Whether the field's reactive Source currently has observers; does not itself track a value. */
  readonly observed: boolean
}

/**
 * Describe a synchronous zero-initialized f64 Store field; this factory takes no arguments and
 * allocates nothing until the Store creates it. Await ensureWasm before Store construction. Number
 * writes use Object.is equality and Source commits; nonnumber writes are INVALID_OPTION. The field
 * owns its Source/block, not the Runtime; disposed value access throws FIELD_DISPOSED.
 */
export function number(): IFieldBuilder<IWasmNumberField> {
  return {
    [FIELD_BUILDER]: true,
    mode: StoreFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmNumberField {
      const block = allocateOwnedSync(8) // f64
      const { memory, ptr } = block
      let source: ReturnType<typeof createSource> | undefined
      try {
        assertWasmFieldNotAborted(signal)
        source = createSource('WasmNumber')
        let disposed = false
        let disposing = false

        const field: IWasmNumberField = {
          get observed() {
            return source!.observed
          },
          get value() {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                StoreWasmErrorText.fieldDisposed
              )
            source!.track()
            return memoryView(memory).getFloat64(ptr, true)
          },
          set value(v) {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                StoreWasmErrorText.fieldDisposed
              )
            if (typeof v !== 'number')
              throw createStoreWasmTypeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.valueType('number', 'number')
              )
            const currentView = memoryView(memory)
            if (Object.is(currentView.getFloat64(ptr, true), v)) return
            source!.commit(() => memoryView(memory).setFloat64(ptr, v, true))
          },
          get disposed() {
            return disposed
          },
          dispose() {
            if (disposed || disposing) return
            disposing = true
            disposed = true
            try {
              // 逆序释放：先摘子资源边，再 dealloc block。
              disposeWasmField(block, field, source === undefined ? [] : [source])
            } finally {
              disposing = false
            }
          }
        }
        block.register(field)
        return field
      } catch (error) {
        try {
          disposeAllWasm([...(source ? [() => source!.dispose()] : []), () => block.dispose()])
        } catch (cleanupError) {
          throwWasmConstructionFailure(error, cleanupError)
        } // 构造失败不泄漏分配
        throw error
      }
    }
  }
}
