import type { IDisposable } from '@migaia/reactive';
import type { IFieldSource } from '@migaia/store-light';
import { allocateOwnedSync } from './arena.js';
import { createStoreWasmError, createStoreWasmTypeError, StoreWasmErrorCode } from './errors.js';
import type { number as numberBuilder } from './number.js';
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js';
import { WasmFieldMode, WasmReservedKey } from './field-constants.js';

// 固定命名字段的结构体（Elm/Haskell record，不是 TS Record<K,V>）
type IRecordShape = Record<string, ReturnType<typeof numberBuilder>>;

export type IWasmRecordField<Shape extends IRecordShape> = {
  [K in keyof Shape]: number;
} & IDisposable;

export function record<Shape extends IRecordShape>(
  shape: Shape
): IFieldBuilder<IWasmRecordField<Shape>> {
  const keys = Object.keys(shape);
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmRecordField<Shape> {
      for (const key of keys) {
        if (key === WasmReservedKey.dispose || key === WasmReservedKey.disposed) {
          throw createStoreWasmTypeError(
            StoreWasmErrorCode.reservedFieldName,
            `[store] wasm.record field name is reserved: ${key}`
          );
        }
      }
      const byteLen = keys.length * 8;
      const block = allocateOwnedSync(byteLen);
      const { memory, ptr } = block;
      const sources: IFieldSource[] = [];
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, '[store] field init aborted');
        const view = () => new DataView(memory.buffer);
        let disposed = false;

        const field = {} as IWasmRecordField<Shape>;
        keys.forEach((key, index) => {
          const offset = ptr + index * 8;
          const source = createSource(`WasmRecord.${key}`);
          sources.push(source);
          Object.defineProperty(field, key, {
            enumerable: true,
            get() {
              if (disposed)
                throw createStoreWasmError(
                  StoreWasmErrorCode.fieldDisposed,
                  '[store] cannot read a disposed wasm field'
                );
              source.track();
              return view().getFloat64(offset, true);
            },
            set(v: number) {
              if (disposed)
                throw createStoreWasmError(
                  StoreWasmErrorCode.fieldDisposed,
                  '[store] cannot write a disposed wasm field'
                );
              const memoryView = view();
              if (Object.is(memoryView.getFloat64(offset, true), v)) return;
              source.commit(() => memoryView.setFloat64(offset, v, true));
            }
          });
        });

        Object.defineProperty(field, 'disposed', {
          enumerable: false,
          get: () => disposed
        });
        Object.defineProperty(field, 'dispose', {
          enumerable: false,
          value: () => {
            if (disposed) return;
            disposed = true;
            block.unregister(field);
            // 逆序释放（migration.sdd.md §5.7）：先摘子资源边，再 dealloc block。
            for (const source of sources) source.dispose();
            block.dispose();
          }
        });

        block.register(field);
        return field;
      } catch (error) {
        for (const source of sources) source.dispose();
        block.dispose();
        throw error;
      }
    }
  };
}
