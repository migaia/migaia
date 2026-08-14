import type { IDisposable } from '@migaia/reactive';
import { allocateOwnedSync } from './arena';
import { FIELD_BUILDER, type FieldBuilder, type FieldContext } from './field';

export type IWasmNumberField = IDisposable & {
  value: number;
  readonly observed: boolean;
};

export function number(): FieldBuilder<IWasmNumberField> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ signal, createSource }: FieldContext): IWasmNumberField {
      const block = allocateOwnedSync(8); // f64
      const { memory, ptr } = block;
      let source: ReturnType<typeof createSource> | undefined;
      try {
        if (signal.aborted) throw new Error('[store] field init aborted');
        source = createSource('WasmNumber');
        const view = () => new DataView(memory.buffer);
        let disposed = false;

        const field: IWasmNumberField = {
          get observed() {
            return source!.observed;
          },
          get value() {
            if (disposed) throw new Error('[store] cannot read a disposed wasm field');
            source!.track();
            return view().getFloat64(ptr, true);
          },
          set value(v) {
            if (disposed) throw new Error('[store] cannot write a disposed wasm field');
            const memoryView = view();
            if (Object.is(memoryView.getFloat64(ptr, true), v)) return;
            source!.commit(() => memoryView.setFloat64(ptr, v, true));
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
        block.dispose(); // 构造失败不泄漏分配
        throw error;
      }
    }
  };
}
