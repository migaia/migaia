import type { IDisposable } from '@migaia/reactive';
import { allocateOwnedSync } from './arena';
import { FIELD_BUILDER, type FieldBuilder, type FieldContext } from './field';

export type IWasmBooleanField = IDisposable & {
  value: boolean;
  readonly observed: boolean;
};

export function boolean(): FieldBuilder<IWasmBooleanField> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ signal, createSource }: FieldContext): IWasmBooleanField {
      const block = allocateOwnedSync(1);
      const { memory, ptr } = block;
      let source: ReturnType<typeof createSource> | undefined;
      try {
        if (signal.aborted) throw new Error('[store] field init aborted');
        source = createSource('WasmBoolean');
        const view = () => new DataView(memory.buffer);
        let disposed = false;

        const field: IWasmBooleanField = {
          get observed() {
            return source!.observed;
          },
          get value() {
            if (disposed) throw new Error('[store] cannot read a disposed wasm field');
            source!.track();
            return view().getUint8(ptr) !== 0;
          },
          set value(v) {
            if (disposed) throw new Error('[store] cannot write a disposed wasm field');
            const memoryView = view();
            const next = v ? 1 : 0;
            if (memoryView.getUint8(ptr) === next) return;
            source!.commit(() => memoryView.setUint8(ptr, next));
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
