import { describe, expect, it } from 'vitest';
import { serializeError, deserializeError, reachError } from '@migaia/web-rpc';
import { StorageError, StorageErrorCode } from '../../src/types/errors.js';
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract';

describe('storage 错误家族经 web-rpc serializer 往返（T-5）', () => {
  it('StorageError（web）往返后 (source, code, name, message, causes) 一致', () => {
    const cause = new Error('root cause');
    const error = new StorageError(StorageErrorCode.quotaExceeded, { cause });
    const serialized = serializeError(error);
    expect(serialized.source).toBe('@migaia/storage-web');
    expect(serialized.code).toBe('QUOTA_EXCEEDED');
    expect(serialized.name).toBe('StorageError');
    expect(serialized.message).toBe(error.message);
    expect(serialized.causes?.[0]?.message).toBe('root cause');

    const restored = deserializeError(serialized) as Error & { source?: string; code?: string };
    expect(restored.source).toBe('@migaia/storage-web');
    expect(restored.code).toBe('QUOTA_EXCEEDED');
    expect(restored.name).toBe('StorageError');
  });

  it('StorageContractError（contract）往返后 source/code/cause 链一致', () => {
    const cause = new TypeError('bad option');
    const error = new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
    const serialized = serializeError(error);
    expect(serialized.source).toBe('@migaia/storage-contract');
    expect(serialized.code).toBe('INVALID_ARGUMENT');
    expect(serialized.name).toBe('StorageContractError');

    const restored = deserializeError(serialized) as Error & { source?: string; code?: string };
    expect(restored.source).toBe('@migaia/storage-contract');
    expect(restored.code).toBe('INVALID_ARGUMENT');
  });

  it('reach() 有限步可达 === original（cause 链 + AggregateError.errors）', () => {
    const root = new Error('root');
    const aggregate = new AggregateError(
      [new StorageContractError(StorageContractErrorCode.aborted, { cause: root })],
      'multi-failure'
    );
    let found = false;
    for (const node of reachError(aggregate)) {
      if (node === root) found = true;
    }
    expect(found).toBe(true);
  });
});
