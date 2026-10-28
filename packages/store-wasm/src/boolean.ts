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

/** Owned single-byte boolean field; the Store field owner releases its Source and native block. */
export type IWasmBooleanField = IDisposable & {
  /** Tracked boolean, initially false; writes require an actual boolean and skip unchanged values. */
  value: boolean
  /** Whether the field's Source currently has observers, without establishing a dependency. */
  readonly observed: boolean
}

/**
 * Describe a synchronous false-initialized Store field, with no factory arguments or eager
 * allocation. Await ensureWasm before the Store creates it. Wrong value types throw INVALID_OPTION;
 * value access after terminal, idempotent field disposal throws FIELD_DISPOSED.
 */
export function boolean(): IFieldBuilder<IWasmBooleanField> {
  return {
    [FIELD_BUILDER]: true,
    mode: StoreFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmBooleanField {
      const block = allocateOwnedSync(1)
      const { memory, ptr } = block
      let source: ReturnType<typeof createSource> | undefined
      try {
        assertWasmFieldNotAborted(signal)
        source = createSource('WasmBoolean')
        let disposed = false
        let disposing = false

        const field: IWasmBooleanField = {
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
            return memoryView(memory).getUint8(ptr) !== 0
          },
          set value(v) {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                StoreWasmErrorText.fieldDisposed
              )
            if (typeof v !== 'boolean')
              throw createStoreWasmTypeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.valueType('boolean', 'boolean')
              )
            const currentView = memoryView(memory)
            const next = v ? 1 : 0
            if (currentView.getUint8(ptr) === next) return
            source!.commit(() => memoryView(memory).setUint8(ptr, next))
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
        }
        throw error
      }
    }
  }
}
