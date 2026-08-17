/** Read a built-in constructor name without invoking user-provided methods. */
export const intrinsicConstructorName = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    return typeof constructor?.name === 'string' ? constructor.name : undefined;
  } catch {
    return undefined;
  }
};

/** Cross-realm runtime check for the exact byte channel input type. */
export const isUint8Array = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && intrinsicConstructorName(value) === 'Uint8Array';
