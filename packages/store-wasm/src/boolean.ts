import type { IDisposable } from '@migaia/reactive'
import { allocateOwnedSync, disposeAllWasm, throwWasmConstructionFailure } from './arena.js'
import { createStoreWasmError, createStoreWasmTypeError, StoreWasmErrorCode } from './errors.js'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js'
import { WasmFieldMode } from './field-constants.js'
import { StoreWasmErrorText } from './error-text.js'

export type IWasmBooleanField = IDisposable & {
  value: boolean
  readonly observed: boolean
}

export function boolean(): IFieldBuilder<IWasmBooleanField> {
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmBooleanField {
      const block = allocateOwnedSync(1)
      const { memory, ptr } = block
      let source: ReturnType<typeof createSource> | undefined
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, StoreWasmErrorText.initAborted)
        source = createSource('WasmBoolean')
        const view = () => new DataView(memory.buffer)
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
            return view().getUint8(ptr) !== 0
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
            const memoryView = view()
            const next = v ? 1 : 0
            if (memoryView.getUint8(ptr) === next) return
            source!.commit(() => memoryView.setUint8(ptr, next))
          },
          get disposed() {
            return disposed
          },
          dispose() {
            if (disposed || disposing) return
            disposing = true
            try {
              block.unregister(field)
              // 逆序释放（migration.sdd.md §5.7）：先摘子资源边，再 dealloc block。
              disposeAllWasm([() => source!.dispose(), () => block.dispose()])
              disposed = true
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
