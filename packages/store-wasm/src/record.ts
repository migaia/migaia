import type { IDisposable } from '@migaia/reactive';
import type { IFieldSource } from '@migaia/store-light';
import { allocateOwnedSync } from './arena';
import type { number as numberBuilder } from './number';
import { FIELD_BUILDER, type FieldBuilder, type FieldContext } from './field';

// 固定命名字段的结构体（Elm/Haskell record，不是 TS Record<K,V>）
type RecordShape = Record<string, ReturnType<typeof numberBuilder>>;

export type IWasmRecordField<Shape extends RecordShape> = {
  [K in keyof Shape]: number;
} & IDisposable;

export function record<Shape extends RecordShape>(
  shape: Shape
): FieldBuilder<IWasmRecordField<Shape>> {
  const keys = Object.keys(shape);
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ signal, createSource }: FieldContext): IWasmRecordField<Shape> {
      for (const key of keys) {
        if (key === 'dispose' || key === 'disposed') {
          throw new TypeError(`[store] wasm.record field name is reserved: ${key}`);
        }
      }
      const byteLen = keys.length * 8;
      const block = allocateOwnedSync(byteLen);
      const { memory, ptr } = block;
      const sources: IFieldSource[] = [];
      try {
        if (signal.aborted) throw new Error('[store] field init aborted');
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
              if (disposed) throw new Error('[store] cannot read a disposed wasm field');
              source.track();
              return view().getFloat64(offset, true);
            },
            set(v: number) {
              if (disposed) throw new Error('[store] cannot write a disposed wasm field');
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
            block.dispose();
            for (const source of sources) source.dispose();
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
