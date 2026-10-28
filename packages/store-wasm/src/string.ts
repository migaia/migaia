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
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  StoreWasmErrorCode
} from './errors.ts'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.ts'
import { StoreFieldMode } from '@migaia/store-light'
import { StoreWasmErrorText } from './error-text.ts'

const DEFAULT_MAX_BYTES = 256
const MAX_STRING_BYTES = 0xffff_ffff - Uint32Array.BYTES_PER_ELEMENT
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Owned fixed-capacity UTF-8 field; capacity is a byte bound, not a JavaScript character count. */
export type IWasmStringField = IDisposable & {
  /** Tracked text, initially empty, encoded with TextEncoder and decoded with TextDecoder. */
  value: string
  /** Whether this field's Source currently has observers, without tracking a read. */
  readonly observed: boolean
}

/**
 * Describe a synchronous Store string field with maxBytes defaulting to 256. Capacity must be a
 * nonnegative safe integer no larger than 0xffffffff - 4; invalid capacity throws INVALID_OPTION.
 * Actual allocation waits for Store construction, which requires completed ensureWasm. Wrong-type
 * or oversized UTF-8 writes reject INVALID_OPTION before changing bytes; value reads after disposal
 * reject FIELD_DISPOSED. The fixed capacity never grows to fit a write.
 */
export function string(maxBytes: number = DEFAULT_MAX_BYTES): IFieldBuilder<IWasmStringField> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_STRING_BYTES) {
    throw createStoreWasmRangeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.stringLimit
    )
  }
  return {
    [FIELD_BUILDER]: true,
    mode: StoreFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmStringField {
      // 前 4 字节存长度，后面定长字节缓冲区（固定容量：地址不能因变长而重分配）
      const block = allocateOwnedSync(4 + maxBytes)
      const { memory, ptr } = block
      let source: ReturnType<typeof createSource> | undefined
      try {
        assertWasmFieldNotAborted(signal)
        source = createSource('WasmString')
        let disposed = false
        let disposing = false
        const readValue = () => {
          const len = memoryView(memory).getUint32(ptr, true)
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
              memoryView(memory).setUint32(ptr, bytes.length, true)
              new Uint8Array(memory.buffer, ptr + 4, bytes.length).set(bytes)
            })
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
