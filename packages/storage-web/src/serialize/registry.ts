import { StorageError, StorageErrorCode } from '../types/errors.js';
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotCodec,
  assertCodec,
  type ICodec,
  type IOperationContext
} from '@migaia/storage-contract';
import { bytesToBase64, base64ToBytes } from '../utils/base64.js';
import { snapshotStorageCapabilities, type IStorageCapabilities } from '../types/capabilities.js';
import { isUint8Array } from '../core/bytes.js';

// codec 描述符 guard 已迁往 `@migaia/storage-contract`；re-export 保持既有 import 路径不变。
export { snapshotCodec, assertCodec };

const toBinaryBytes = (value: unknown): Uint8Array => {
  if (!isUint8Array(value))
    throw new StorageError(StorageErrorCode.serializeFailed, {
      cause: new TypeError('binary codec must return a Uint8Array')
    });
  const view = value as Uint8Array;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
};

const fromBase64 = (value: unknown): Uint8Array => {
  if (typeof value !== 'string')
    throw new StorageError(StorageErrorCode.deserializeFailed, {
      cause: new TypeError('binary fallback expects a base64 string')
    });
  try {
    return base64ToBytes(value);
  } catch (cause) {
    throw new StorageError(StorageErrorCode.deserializeFailed, { cause });
  }
};

export type ISelectedCodec = {
  /** 选路后实际要写入存储的字符串或字节。 */
  encode(
    value: unknown,
    ctx?: { signal?: NonNullable<IOperationContext['signal']> }
  ): Promise<string | Uint8Array | unknown>;
  decode(
    raw: string | Uint8Array | unknown,
    ctx?: { signal?: NonNullable<IOperationContext['signal']> }
  ): Promise<unknown>;
};

/**
 * 选路规则：
 *
 * 1. Codec.output 与后端 capabilities 匹配 → 直连。
 * 2. Binary codec 遇 text-only 后端 → 自动 base64 包装，体积 +33%， 通过 onDiagnostic 报一次，不是静默发生。
 * 3. Structured codec 遇 text-only 后端 → 抛 UNSUPPORTED_CAPABILITY。 structured clone
 *    的能力（Blob/Map/Set/循环引用）无法用 JSON 表达， 静默降级会丢数据，这里不做隐式转换。
 */
export const selectCodec = (
  codec: ICodec,
  capabilities: IStorageCapabilities,
  onDiagnostic?: (message: string) => void
): ISelectedCodec => {
  const normalizedCodec = snapshotCodec(codec);
  const normalizedCapabilities = snapshotStorageCapabilities(capabilities);
  if (!normalizedCapabilities)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('capabilities must be a complete storage descriptor')
    });
  if (onDiagnostic !== undefined && typeof onDiagnostic !== 'function')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('onDiagnostic must be a function')
    });
  if (normalizedCodec.output === 'structured') {
    if (!normalizedCapabilities.records)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        cause: new Error(
          `codec "${normalizedCodec.name}" produces structured output but the backend only supports text`
        )
      });
    return normalizedCodec;
  }

  if (normalizedCodec.output === 'binary') {
    if (normalizedCapabilities.binary) return normalizedCodec;
    try {
      onDiagnostic?.(
        `[storage-web] codec "${normalizedCodec.name}" falls back to base64 on a text-only backend (+33% size)`
      );
    } catch {
      // Diagnostics are observational; a broken sink cannot change codec selection.
    }
    return {
      encode: async (value, ctx) =>
        bytesToBase64(toBinaryBytes(await normalizedCodec.encode(value, ctx))),
      decode: async (raw, ctx) => normalizedCodec.decode(fromBase64(raw), ctx)
    };
  }

  return normalizedCodec;
};
