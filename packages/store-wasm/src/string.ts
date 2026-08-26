import type { IDisposable } from '@migaia/reactive'
import { allocateOwnedSync, disposeAllWasm, throwWasmConstructionFailure } from './arena.js'
import {
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  StoreWasmErrorCode
} from './errors.js'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js'
import { WasmFieldMode } from './field-constants.js'
import { StoreWasmErrorText } from './error-text.js'

const DEFAULT_MAX_BYTES = 256
const MAX_STRING_BYTES = 0xffff_ffff - Uint32Array.BYTES_PER_ELEMENT
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type IWasmStringField = IDisposable & {
  value: string
  readonly observed: boolean
}

export function string(maxBytes: number = DEFAULT_MAX_BYTES): IFieldBuilder<IWasmStringField> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_STRING_BYTES) {
    throw createStoreWasmRangeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.stringLimit
    )
  }
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmStringField {
      // 前 4 字节存长度，后面定长字节缓冲区（固定容量：地址不能因变长而重分配）
      const block = allocateOwnedSync(4 + maxBytes)
      const { memory, ptr } = block
      let source: ReturnType<typeof createSource> | undefined
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, StoreWasmErrorText.initAborted)
        source = createSource('WasmString')
        const view = () => new DataView(memory.buffer)
        let disposed = false
        let disposing = false
        const readValue = () => {
          const len = view().getUint32(ptr, true)
          if (len > maxBytes)
            throw createStoreWasmError(
              StoreWasmErrorCode.allocationFailed,
              StoreWasmErrorText.corruptedLength
            )
          return decoder.decode(new Uint8Array(memory.buffer, ptr + 4, len))
        }

        const field: IWasmStringField = {
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
            return readValue()
          },
          set value(v) {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                StoreWasmErrorText.fieldDisposed
              )
            if (typeof v !== 'string')
              throw createStoreWasmTypeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.valueType('string', 'string')
              )
            const bytes = encoder.encode(v)
            if (bytes.length > maxBytes) {
              throw createStoreWasmError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.valueTooLarge(bytes.length, maxBytes)
              )
            }
            if (readValue() === v) return
            source!.commit(() => {
              view().setUint32(ptr, bytes.length, true)
              new Uint8Array(memory.buffer, ptr + 4, bytes.length).set(bytes)
            })
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
