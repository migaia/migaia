import { memoryView } from './memory-view.js'
import type { IDisposable } from '@migaia/reactive'
import {
  allocateOwnedSync,
  disposeAllWasm,
  disposeWasmField,
  throwWasmConstructionFailure
} from './arena.js'
import {
  assertWasmFieldNotAborted,
  createStoreWasmError,
  createStoreWasmTypeError,
  StoreWasmErrorCode
} from './errors.js'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js'
import { StoreFieldMode } from '@migaia/store-light'
import { StoreWasmErrorText } from './error-text.js'

export type IWasmNumberField = IDisposable & {
  value: number
  readonly observed: boolean
}

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
