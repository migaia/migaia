import type { IDisposable } from '@migaia/reactive'
import { allocateOwnedSync, disposeAllWasm, throwWasmConstructionFailure } from './arena.js'
import { createStoreWasmError, createStoreWasmTypeError, StoreWasmErrorCode } from './errors.js'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js'
import { WasmFieldMode } from './field-constants.js'
import { StoreWasmErrorText } from './error-text.js'

export type IWasmNumberField = IDisposable & {
  value: number
  readonly observed: boolean
}

export function number(): IFieldBuilder<IWasmNumberField> {
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmNumberField {
      const block = allocateOwnedSync(8) // f64
      const { memory, ptr } = block
      let source: ReturnType<typeof createSource> | undefined
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, StoreWasmErrorText.initAborted)
        source = createSource('WasmNumber')
        const view = () => new DataView(memory.buffer)
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
            return view().getFloat64(ptr, true)
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
            const memoryView = view()
            if (Object.is(memoryView.getFloat64(ptr, true), v)) return
            source!.commit(() => memoryView.setFloat64(ptr, v, true))
          },
          get disposed() {
            return disposed
          },
          dispose() {
            if (disposed || disposing) return
            disposing = true
            disposed = true
            try {
              block.unregister(field)
              // 逆序释放（migration.sdd.md §5.7）：先摘子资源边，再 dealloc block。
              disposeAllWasm([() => source!.dispose(), () => block.dispose()])
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
