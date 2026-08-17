import { StorageContractError, StorageContractErrorCode } from './errors.js';
import { intrinsicConstructorName } from './bytes.js';
import type { IBackendKind } from './capabilities.js';
import type { IKeyRange, IStorageKey } from './context.js';

/** Hard limits protect flat-key decoding from pathological persisted input. */
export const KEY_DOMAIN_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 4096,
  maxBinaryBytes: 1024 * 1024
} as const);

/** Validate keys for L0, bytes, and metadata channels whose contract is string-only. */
export function assertStringStorageKey(
  value: unknown,
  backend: IBackendKind,
  label = 'key'
): asserts value is string {
  if (typeof value !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(`${label} must be a string`)
    });
}

const dateValue = (value: unknown): number | undefined => {
  // 同 realm 走 `instanceof`（不可伪造）；跨 realm 走原型链内建构造器名 + 行为校验（真实 Date 才有内建 `getTime`）。
  // 全程不触发 `Symbol.toStringTag`、不调用宿主方法、hostile getter 被 try/catch 收容，`Object.create({constructor:{name:'Date'}})` 无 `getTime` 会被拒绝。
  if (value instanceof Date) {
    try {
      return value.getTime();
    } catch {
      return undefined;
    }
  }
  if (intrinsicConstructorName(value) !== 'Date') return undefined;
  try {
    if (typeof (value as Date).getTime !== 'function') return undefined;
    return (value as Date).getTime();
  } catch {
    return undefined;
  }
};

const bufferValue = (value: unknown): ArrayBuffer | undefined => {
  // 同 realm 走 `instanceof`；跨 realm 走原型链内建构造器名 + 行为校验（真实 ArrayBuffer 才有内建 `slice`）。
  // `Object.create({constructor:{name:'ArrayBuffer'}})` 无 `slice`，会被拒绝；forgery 也不触发宿主异常。
  if (value instanceof ArrayBuffer) {
    try {
      return new Uint8Array(value).slice().buffer;
    } catch {
      return undefined;
    }
  }
  if (intrinsicConstructorName(value) !== 'ArrayBuffer') return undefined;
  try {
    if (typeof (value as ArrayBuffer).slice !== 'function') return undefined;
    return new Uint8Array(value as ArrayBuffer).slice().buffer;
  } catch {
    return undefined;
  }
};

/**
 * Validate the IndexedDB-compatible key domain. Date/ArrayBuffer 经 `intrinsicConstructorName`
 * 走原型链内建构造器名分类： 跨 realm 安全、不触发 `Symbol.toStringTag` getter、不调用宿主方法，且 hostile getter 异常被内部 try/catch
 * 收容。
 */
export function assertStorageKey(
  value: unknown,
  backend: IBackendKind,
  label = 'key'
): asserts value is IStorageKey {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number, seen: Set<unknown>): boolean => {
    nodes += 1;
    if (nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth) return false;
    if (typeof candidate === 'string') return true;
    if (typeof candidate === 'number') return Number.isFinite(candidate);
    const date = dateValue(candidate);
    if (date !== undefined) return !Number.isNaN(date);
    const buffer = bufferValue(candidate);
    if (buffer !== undefined) return buffer.byteLength <= KEY_DOMAIN_LIMITS.maxBinaryBytes;
    if (!Array.isArray(candidate) || candidate.length === 0 || seen.has(candidate)) return false;
    seen.add(candidate);
    const valid = candidate.every((item) => visit(item, depth + 1, seen));
    seen.delete(candidate);
    return valid;
  };
  if (!visit(value, 0, new Set()))
    throw new StorageContractError(StorageContractErrorCode.invalidKey, {
      backend,
      key: value as IStorageKey,
      cause: new TypeError(`invalid ${label}`)
    });
}

/** Compare keys using the same cross-realm classification as validation and encoding. */
export const compareStorageKeys = (a: IStorageKey, b: IStorageKey): number => {
  const rank = (value: IStorageKey): number => {
    if (typeof value === 'number') return 0;
    if (dateValue(value) !== undefined) return 1;
    if (typeof value === 'string') return 2;
    if (bufferValue(value) !== undefined) return 3;
    return 4;
  };
  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) return rankA - rankB;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const dateA = dateValue(a);
  const dateB = dateValue(b);
  if (dateA !== undefined && dateB !== undefined) return dateA - dateB;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const bytesA = bufferValue(a);
  const bytesB = bufferValue(b);
  if (bytesA !== undefined && bytesB !== undefined) {
    const viewA = new Uint8Array(bytesA);
    const viewB = new Uint8Array(bytesB);
    const length = Math.min(viewA.length, viewB.length);
    for (let index = 0; index < length; index += 1) {
      if (viewA[index] !== viewB[index]) return viewA[index]! - viewB[index]!;
    }
    return viewA.length - viewB.length;
  }
  const arrayA = a as readonly IStorageKey[];
  const arrayB = b as readonly IStorageKey[];
  const length = Math.min(arrayA.length, arrayB.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareStorageKeys(arrayA[index]!, arrayB[index]!);
    if (comparison !== 0) return comparison;
  }
  return arrayA.length - arrayB.length;
};

export type { IKeyRange, IStorageKey };
