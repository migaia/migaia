import type { IDisposable } from '@migaia/reactive';
import type { IFieldSource } from '@migaia/store-light';
import { allocateOwnedSync, disposeAllWasm, throwWasmConstructionFailure } from './arena.js';
import { createStoreWasmError, createStoreWasmTypeError, StoreWasmErrorCode } from './errors.js';
import type { number as numberBuilder } from './number.js';
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js';
import { WasmFieldMode, WasmReservedKey } from './field-constants.js';
import { StoreWasmErrorText } from './error-text.js';

// 固定命名字段的结构体（Elm/Haskell record，不是 TS Record<K,V>）
type IRecordShape = Record<string, ReturnType<typeof numberBuilder>>;

export type IWasmRecordField<Shape extends IRecordShape> = {
  [K in keyof Shape]: number;
} & IDisposable;

export function record<Shape extends IRecordShape>(
  shape: Shape
): IFieldBuilder<IWasmRecordField<Shape>> {
  let isArray = false;
  try {
    isArray = Array.isArray(shape);
  } catch (error) {
    throw createStoreWasmTypeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.recordShapeInvalid,
      { cause: error }
    );
  }
  if (shape === null || typeof shape !== 'object' || isArray) {
    throw createStoreWasmTypeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.recordShapeInvalid
    );
  }
  let keys: string[];
  try {
    keys = Object.keys(shape);
  } catch (error) {
    throw createStoreWasmTypeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.recordShapeInvalid,
      { cause: error }
    );
  }
  if (
    keys.some((key) => {
      try {
        const builder = shape[key as keyof Shape];
        return builder === null || typeof builder !== 'object' || builder[FIELD_BUILDER] !== true;
      } catch (error) {
        throw createStoreWasmTypeError(
          StoreWasmErrorCode.invalidOption,
          StoreWasmErrorText.recordShapeInvalid,
          { cause: error }
        );
      }
    })
  ) {
    throw createStoreWasmTypeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.recordShapeInvalid
    );
  }
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource }: IFieldContext): IWasmRecordField<Shape> {
      for (const key of keys) {
        if (key === WasmReservedKey.dispose || key === WasmReservedKey.disposed) {
          throw createStoreWasmTypeError(
            StoreWasmErrorCode.reservedFieldName,
            StoreWasmErrorText.reservedField(key)
          );
        }
      }
      const byteLen = keys.length * 8;
      const block = allocateOwnedSync(byteLen);
      const { memory, ptr } = block;
      const sources: IFieldSource[] = [];
      try {
        if (signal.aborted)
          throw createStoreWasmError(
            StoreWasmErrorCode.initAborted,
            StoreWasmErrorText.initAborted
          );
        const view = () => new DataView(memory.buffer);
        let disposed = false;
        let disposing = false;

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
                  StoreWasmErrorText.fieldDisposed
                );
              source.track();
              return view().getFloat64(offset, true);
            },
            set(v: number) {
              if (disposed)
                throw createStoreWasmError(
                  StoreWasmErrorCode.fieldDisposed,
                  StoreWasmErrorText.fieldDisposed
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
            if (disposed || disposing) return;
            disposing = true;
            try {
              block.unregister(field);
              // 逆序释放（migration.sdd.md §5.7）：先摘子资源边，再 dealloc block。
              disposeAllWasm([
                ...sources.map((source) => () => source.dispose()),
                () => block.dispose()
              ]);
              disposed = true;
            } finally {
              disposing = false;
            }
          }
        });

        block.register(field);
        return field;
      } catch (error) {
        try {
          disposeAllWasm([
            ...sources.map((source) => () => source.dispose()),
            () => block.dispose()
          ]);
        } catch (cleanupError) {
          throwWasmConstructionFailure(error, cleanupError);
        }
        throw error;
      }
    }
  };
}
