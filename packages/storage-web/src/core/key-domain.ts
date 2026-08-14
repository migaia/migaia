import { base64ToBytes, bytesToBase64 } from '../utils/base64';
import type { IBackendKind } from '../types/capabilities';
import type { IKeyRange, IStorageKey } from '../types/context';
import { StorageError, StorageErrorCode } from '../types/errors';
import { intrinsicConstructorName } from './brand';

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
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(`${label} must be a string`)
    });
}

const dateValue = (value: unknown): number | undefined => {
  if (intrinsicConstructorName(value) !== 'Date') return undefined;
  try {
    const clone = globalThis.structuredClone;
    if (typeof clone === 'function') {
      const cloned = clone(value);
      return intrinsicConstructorName(cloned) === 'Date' ? (cloned as Date).getTime() : undefined;
    }
    return value instanceof Date ? value.getTime() : undefined;
  } catch {
    return undefined;
  }
};

const bufferValue = (value: unknown): ArrayBuffer | undefined => {
  if (intrinsicConstructorName(value) !== 'ArrayBuffer') return undefined;
  try {
    const clone = globalThis.structuredClone;
    const cloned =
      typeof clone === 'function' ? clone(value) : value instanceof ArrayBuffer ? value : undefined;
    if (cloned === undefined) return undefined;
    if (intrinsicConstructorName(cloned) !== 'ArrayBuffer') return undefined;
    const bytes = new Uint8Array(cloned as ArrayBuffer);
    return bytes.slice().buffer;
  } catch {
    return undefined;
  }
};

/** Validate the IndexedDB-compatible key domain without relying on realm-local instanceof. */
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
    throw new StorageError(StorageErrorCode.invalidKey, {
      backend,
      key: value as IStorageKey,
      cause: new TypeError(`invalid ${label}`)
    });
}

const toWire = (value: IStorageKey): unknown => {
  if (typeof value === 'string') return ['s', value];
  if (typeof value === 'number') return ['n', value];
  const date = dateValue(value);
  if (date !== undefined) return ['d', date];
  const buffer = bufferValue(value);
  if (buffer !== undefined) return ['b', bytesToBase64(new Uint8Array(buffer))];
  return ['a', (value as readonly IStorageKey[]).map(toWire)];
};

/** Encode a validated key reversibly for flat backends. */
export const encodeFlatStorageKey = (value: IStorageKey): string =>
  `k:${encodeURIComponent(JSON.stringify(toWire(value)))}`;

/** Decode a flat key with bounded iterative recursion and final domain validation. */
export const decodeFlatStorageKey = (
  encoded: string,
  backend: IBackendKind = 'memory'
): IStorageKey | undefined => {
  try {
    if (!encoded.startsWith('k:')) return undefined;
    const root = JSON.parse(decodeURIComponent(encoded.slice(2))) as unknown;
    let nodes = 0;
    const decode = (wire: unknown, depth: number): IStorageKey => {
      nodes += 1;
      if (nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth)
        throw new RangeError('storage key exceeds decode limits');
      if (!Array.isArray(wire) || wire.length !== 2 || typeof wire[0] !== 'string')
        throw new TypeError('invalid storage key wire');
      const [tag, payload] = wire;
      if (tag === 's' && typeof payload === 'string') return payload;
      if (tag === 'n' && typeof payload === 'number' && Number.isFinite(payload)) return payload;
      if (tag === 'd' && typeof payload === 'number') return new Date(payload);
      if (tag === 'b' && typeof payload === 'string') {
        const bytes = base64ToBytes(payload);
        if (bytes.byteLength > KEY_DOMAIN_LIMITS.maxBinaryBytes)
          throw new RangeError('key too large');
        return bytes.slice().buffer as ArrayBuffer;
      }
      if (tag === 'a' && Array.isArray(payload) && payload.length > 0)
        return payload.map((item) => decode(item, depth + 1));
      throw new TypeError('invalid storage key wire tag');
    };
    const result = decode(root, 0);
    assertStorageKey(result, backend);
    return result;
  } catch {
    return undefined;
  }
};

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

/** Read and validate a range once so getter-backed inputs cannot change after validation. */
export const snapshotKeyRange = (
  range: IKeyRange | undefined,
  backend: IBackendKind
): IKeyRange | undefined => {
  if (range === undefined) return;
  if (typeof range !== 'object' || range === null || Array.isArray(range))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('key range must be an object')
    });
  let snapshot: IKeyRange;
  try {
    snapshot = {
      lower: range.lower,
      lowerOpen: range.lowerOpen,
      upper: range.upper,
      upperOpen: range.upperOpen
    };
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { backend, cause });
  }
  if (
    (snapshot.lowerOpen !== undefined && typeof snapshot.lowerOpen !== 'boolean') ||
    (snapshot.upperOpen !== undefined && typeof snapshot.upperOpen !== 'boolean')
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('key range open flags must be boolean')
    });
  /** Clone one range bound before validation so later caller mutation cannot alter the operation. */
  const snapshotBound = (value: IStorageKey, label: string): IStorageKey => {
    try {
      /** Native clone when available; canonical wire round-trip preserves older-runtime support. */
      const clone = globalThis.structuredClone;
      /** Detached key ownership transferred to the normalized range snapshot. */
      const cloned: unknown =
        typeof value === 'string' || typeof value === 'number'
          ? value
          : typeof clone === 'function'
            ? clone(value)
            : decodeFlatStorageKey(encodeFlatStorageKey(value), backend);
      assertStorageKey(cloned, backend, label);
      return cloned;
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw new StorageError(StorageErrorCode.invalidKey, {
        backend,
        key: value,
        cause: new TypeError(`invalid ${label}`, { cause })
      });
    }
  };
  /** Fully detached range used by every downstream comparison and backend adapter. */
  const normalized: IKeyRange = {
    lower: snapshot.lower === undefined ? undefined : snapshotBound(snapshot.lower, 'range.lower'),
    lowerOpen: snapshot.lowerOpen,
    upper: snapshot.upper === undefined ? undefined : snapshotBound(snapshot.upper, 'range.upper'),
    upperOpen: snapshot.upperOpen
  };
  if (normalized.lower !== undefined && normalized.upper !== undefined) {
    const comparison = compareStorageKeys(normalized.lower, normalized.upper);
    if (comparison > 0 || (comparison === 0 && (normalized.lowerOpen || normalized.upperOpen)))
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend,
        cause: new RangeError('invalid key range')
      });
  }
  return normalized;
};

/** Validate a range when no caller needs to retain the stable snapshot. */
export const assertKeyRange = (range: IKeyRange | undefined, backend: IBackendKind): void => {
  snapshotKeyRange(range, backend);
};
