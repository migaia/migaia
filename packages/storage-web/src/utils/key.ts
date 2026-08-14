import type { IBackendKind } from '../types/capabilities';
import { StorageError, StorageErrorCode } from '../types/errors';
import { normalizeError } from '../core/errors';

/** Namespace/key codec boundary. Custom codecs own migration and collision safety. */
export type INamespaceCodec = {
  encode(namespace: string, key: string): string;
  decode(namespace: string, physicalKey: string): string | undefined;
};

/** Default collision-free namespace codec. */
export const lengthPrefixedNamespaceCodec: INamespaceCodec = Object.freeze({
  encode: (namespace, key) => {
    const encodedNamespace = encodeURIComponent(namespace);
    return `sw1:${new TextEncoder().encode(namespace).byteLength}:${encodedNamespace}:${key}`;
  },
  decode: (namespace, physicalKey) => {
    if (!physicalKey.startsWith('sw1:')) return undefined;
    const rest = physicalKey.slice(4);
    const lengthSeparator = rest.indexOf(':');
    if (lengthSeparator < 0) return undefined;
    const byteLength = Number(rest.slice(0, lengthSeparator));
    const encoded = rest.slice(lengthSeparator + 1);
    const namespaceSeparator = encoded.indexOf(':');
    if (namespaceSeparator < 0) return undefined;
    const decodedNamespace = decodeURIComponent(encoded.slice(0, namespaceSeparator));
    if (decodedNamespace !== namespace) return undefined;
    if (new TextEncoder().encode(decodedNamespace).byteLength !== byteLength) return undefined;
    return encoded.slice(namespaceSeparator + 1);
  }
});

/**
 * Snapshot a namespace codec descriptor so backend lifetime behavior cannot follow accessor
 * changes.
 */
export const snapshotNamespaceCodec = (
  codec: unknown,
  backend: IBackendKind = 'local'
): INamespaceCodec => {
  if (typeof codec !== 'object' || codec === null || Array.isArray(codec))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('namespace codec must provide callable encode and decode methods')
    });
  const candidate = codec as Record<string, unknown>;
  let encode: unknown;
  let decode: unknown;
  try {
    encode = candidate.encode;
    decode = candidate.decode;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { backend, cause });
  }
  if (typeof encode !== 'function' || typeof decode !== 'function')
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('namespace codec must provide callable encode and decode methods')
    });
  return { encode, decode } as INamespaceCodec;
};

/** Namespace-aware physical key encoding. */
export const namespacedKey = (
  namespace: string,
  key: string,
  codec: INamespaceCodec = lengthPrefixedNamespaceCodec,
  backend: IBackendKind = 'local'
): string => {
  if (typeof namespace !== 'string' || typeof key !== 'string')
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('namespace and key must be strings')
    });
  try {
    const physicalKey = codec.encode(namespace, key);
    if (typeof physicalKey !== 'string')
      throw new TypeError('namespace codec encode must return a string');
    return physicalKey;
  } catch (cause) {
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.extensionFailed,
      'namespace.encode',
      'codec'
    );
  }
};

/** Decode a physical key, returning undefined only when it belongs to another namespace. */
export const stripNamespace = (
  namespace: string,
  physicalKey: string,
  codec: INamespaceCodec = lengthPrefixedNamespaceCodec,
  backend: IBackendKind = 'local'
): string | undefined => {
  if (typeof namespace !== 'string' || typeof physicalKey !== 'string')
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('namespace and physicalKey must be strings')
    });
  try {
    const key = codec.decode(namespace, physicalKey);
    if (key !== undefined && typeof key !== 'string')
      throw new TypeError('namespace codec decode must return string or undefined');
    return key;
  } catch (cause) {
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.extensionFailed,
      'namespace.decode',
      'codec'
    );
  }
};
