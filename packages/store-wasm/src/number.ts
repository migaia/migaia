import type { IDisposable } from '@migaia/reactive';
import { allocateOwnedSync } from './arena.js';
import { createStoreWasmError, StoreWasmErrorCode } from './errors.js';
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js';
import { WasmFieldMode } from './field-constants.js';

export type IWasmNumberField = IDisposable & {
  value: number;
  readonly observed: boolean;
};

export function number(): IFieldBuilder<IWasmNumberField> {
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmNumberField {
      const block = allocateOwnedSync(8); // f64
      const { memory, ptr } = block;
      let source: ReturnType<typeof createSource> | undefined;
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, '[store] field init aborted');
        source = createSource('WasmNumber');
        const view = () => new DataView(memory.buffer);
        let disposed = false;

        const field: IWasmNumberField = {
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
            return view().getFloat64(ptr, true);
          },
          set value(v) {
            if (disposed)
              throw createStoreWasmError(
                StoreWasmErrorCode.fieldDisposed,
                '[store] cannot write a disposed wasm field'
              );
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
            // 逆序释放（migration.sdd.md §5.7）：先摘子资源边，再 dealloc block。
            source!.dispose();
            block.dispose();
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
