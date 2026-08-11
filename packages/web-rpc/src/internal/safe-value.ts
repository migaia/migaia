/** Reads an untrusted property without allowing getters or proxies to escape. */
export function safeRead<T>(value: unknown, key: PropertyKey): T | undefined {
  try {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
      return undefined;
    return (value as Record<PropertyKey, T>)[key];
  } catch {
    return undefined;
  }
}

/** Accepts only finite safe integer values from an untrusted boundary. */
export function isSafeIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Recognizes Uint8Array payloads without relying on the current realm constructor. */
export function isUint8Array(value: unknown): value is Uint8Array {
  try {
    const constructor = safeRead<unknown>(value, 'constructor');
    const constructorName = safeRead<unknown>(constructor, 'name');
    return (
      ArrayBuffer.isView(value) &&
      (value as Uint8Array).BYTES_PER_ELEMENT === 1 &&
      constructorName === 'Uint8Array'
    );
  } catch {
    return false;
  }
}

/** Converts an untrusted value to text without invoking a hostile conversion twice. */
export function safeString(value: unknown, fallback = 'Unknown error'): string {
  try {
    return typeof value === 'string' ? value : String(value);
  } catch {
    return fallback;
  }
}

/** Builds an injective key for attacker-controlled tuple components. */
export function tupleKey(...parts: readonly string[]): string {
  return JSON.stringify(parts);
}

/** Creates a dictionary that cannot interpret attacker-controlled keys as properties. */
export function createSafeRecord<T>(): Partial<Record<string, T>> {
  return Object.create(null) as Partial<Record<string, T>>;
}
