import type { IDisposable } from '@migaia/reactive';
import { allocateOwnedSync } from './arena';
import { FIELD_BUILDER, type FieldBuilder, type FieldContext } from './field';

const DEFAULT_MAX_BYTES = 256;
const MAX_STRING_BYTES = 0xffff_ffff - Uint32Array.BYTES_PER_ELEMENT;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type IWasmStringField = IDisposable & {
  value: string;
  readonly observed: boolean;
};

export function string(maxBytes: number = DEFAULT_MAX_BYTES): FieldBuilder<IWasmStringField> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_STRING_BYTES) {
    throw new RangeError('wasm.string: maxBytes exceeds the Wasm32 allocation limit');
  }
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ signal, createSource }: FieldContext): IWasmStringField {
      // 前 4 字节存长度，后面定长字节缓冲区（固定容量：地址不能因变长而重分配）
      const block = allocateOwnedSync(4 + maxBytes);
      const { memory, ptr } = block;
      let source: ReturnType<typeof createSource> | undefined;
      try {
        if (signal.aborted) throw new Error('[store] field init aborted');
        source = createSource('WasmString');
        const view = () => new DataView(memory.buffer);
        let disposed = false;
        const readValue = () => {
          const len = view().getUint32(ptr, true);
          if (len > maxBytes) throw new Error('wasm.string: corrupted byte length');
          return decoder.decode(new Uint8Array(memory.buffer, ptr + 4, len));
        };

        const field: IWasmStringField = {
          get observed() {
            return source!.observed;
          },
          get value() {
            if (disposed) throw new Error('[store] cannot read a disposed wasm field');
            source!.track();
            return readValue();
          },
          set value(v) {
            if (disposed) throw new Error('[store] cannot write a disposed wasm field');
            const bytes = encoder.encode(v);
            if (bytes.length > maxBytes) {
              throw new Error(
                `wasm.string: value exceeds maxBytes (${bytes.length} > ${maxBytes})`
              );
            }
            if (readValue() === v) return;
            source!.commit(() => {
              view().setUint32(ptr, bytes.length, true);
              new Uint8Array(memory.buffer, ptr + 4, bytes.length).set(bytes);
            });
          },
          get disposed() {
            return disposed;
          },
          dispose() {
            if (disposed) return;
            disposed = true;
            block.unregister(field);
            block.dispose();
            source!.dispose();
          }
        };
        block.register(field);
        return field;
      } catch (error) {
        source?.dispose();
        block.dispose();
        throw error;
      }
    }
  };
}
