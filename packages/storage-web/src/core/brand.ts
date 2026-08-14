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
