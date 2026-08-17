import type { IDisposable } from '@migaia/reactive';
import { allocateOwnedSync } from './arena.js';
import { createStoreWasmError, StoreWasmErrorCode } from './errors.js';
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js';
import { WasmFieldMode } from './field-constants.js';

export type IWasmBooleanField = IDisposable & {
  value: boolean;
  readonly observed: boolean;
};

export function boolean(): IFieldBuilder<IWasmBooleanField> {
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmBooleanField {
      const block = allocateOwnedSync(1);
      const { memory, ptr } = block;
      let source: ReturnType<typeof createSource> | undefined;
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, '[store] field init aborted');
        source = createSource('WasmBoolean');
        const view = () => new DataView(memory.buffer);
        let disposed = false;

        const field: IWasmBooleanField = {
          get observed() {
            return source!.observed;
          },
          get value() {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                '[store] cannot read a disposed wasm field'
              );
            source!.track();
            return view().getUint8(ptr) !== 0;
          },
          set value(v) {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                '[store] cannot write a disposed wasm field'
              );
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
            // 逆序释放（migration.sdd.md §5.7）：先摘子资源边，再 dealloc block。
            source!.dispose();
            block.dispose();
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
