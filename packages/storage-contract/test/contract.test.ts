import { describe, expect, it } from 'vitest';
import {
  STORAGE_CONTRACT_SOURCE,
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  snapshotOperationContext,
  isStorageContractError
} from '../src/index.js';

describe('StorageContractError 家族', () => {
  it('5 码 + source 恒为 @migaia/storage-contract', () => {
    expect(Object.keys(StorageContractErrorCode).sort()).toEqual([
      'aborted',
      'disposed',
      'invalidArgument',
      'invalidKey',
      'unsupported'
    ]);
    const error = new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('bad')
    });
    expect(error.source).toBe(STORAGE_CONTRACT_SOURCE);
    expect(error.source).toBe('@migaia/storage-contract');
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.name).toBe('StorageContractError');
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(isStorageContractError(error)).toBe(true);
  });

  it('码以 Object.freeze 冻结、stack 非空', () => {
    const error = new StorageContractError(StorageContractErrorCode.aborted);
    expect(error.stack).toBeTruthy();
    expect(Object.isFrozen(error)).toBe(true);
    expect(() => {
      (error as { code: string }).code = 'changed';
    }).toThrow(TypeError);
  });
});

describe('assertStorageKey 伪造品牌防护（实现期安全回归）', () => {
  it('拒绝伪造 ArrayBuffer 品牌（constructor.name 伪造）', () => {
    const forged = Object.create({ constructor: { name: 'ArrayBuffer' } });
    expect(() => assertStorageKey(forged, 'memory', 'key')).toThrow(StorageContractError);
    try {
      assertStorageKey(forged, 'memory', 'key');
      throw new Error('unreachable');
    } catch (error) {
      expect((error as StorageContractError).code).toBe(StorageContractErrorCode.invalidKey);
    }
  });

  it('拒绝伪造 Date 品牌', () => {
    const forged = Object.create({ constructor: { name: 'Date' } });
    expect(() => assertStorageKey(forged, 'memory', 'key')).toThrow(StorageContractError);
  });

  it('接受真实 ArrayBuffer / Date key', () => {
    expect(() => assertStorageKey(new ArrayBuffer(8), 'memory', 'key')).not.toThrow();
    expect(() => assertStorageKey(new Date(), 'memory', 'key')).not.toThrow();
    expect(() => assertStorageKey('plain', 'memory', 'key')).not.toThrow();
    expect(() => assertStorageKey(42, 'memory', 'key')).not.toThrow();
  });
});

describe('信号结构等价（真实 AbortSignal 满足 IAbortSignal）', () => {
  it('真实 AbortController().signal 被 snapshotOperationContext 接受', () => {
    const controller = new AbortController();
    const snapshot = snapshotOperationContext({ signal: controller.signal });
    expect(snapshot?.signal).toBe(controller.signal);
  });

  it('非法 timeoutMs / pageSize 抛 contract invalidArgument', () => {
    expect(() => snapshotOperationContext({ timeoutMs: -1 } as never)).toThrow(
      StorageContractError
    );
    expect(() => snapshotOperationContext({ pageSize: 0 } as never)).toThrow(StorageContractError);
  });
});
