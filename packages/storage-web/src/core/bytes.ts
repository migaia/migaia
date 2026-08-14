import { intrinsicConstructorName } from './brand';

/** Cross-realm runtime check for the exact byte channel input type. */
export const isUint8Array = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && intrinsicConstructorName(value) === 'Uint8Array';
