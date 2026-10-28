import type { ISqlValue } from '@migaia/storage-contract'
import type { IPgNativeArrayParameter, IPgNativeParameter } from './types.ts'
import { invalidArgument } from './errors.ts'
import { PostgresErrorText } from './error-text.ts'
/** One array-text encoder is used by all three actual adapters and both root/transaction batches. */
function arrayText(input: IPgNativeArrayParameter): string {
  const arrayType = input.arrayType
  const values = input.values
  if (!Array.isArray(values) || (arrayType !== 'text' && arrayType !== 'float8'))
    throw invalidArgument(new TypeError(PostgresErrorText.invalidArray))
  const encoded: string[] = []
  for (const value of values) {
    if (value === null) {
      encoded.push('NULL')
      continue
    }
    if (arrayType === 'float8') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw invalidArgument(new TypeError(PostgresErrorText.invalidArray))
      encoded.push(String(value))
    } else {
      if (typeof value !== 'string')
        throw invalidArgument(new TypeError(PostgresErrorText.invalidArray))
      encoded.push('"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"')
    }
  }
  return '{' + encoded.join(',') + '}'
}
/** Capture native arguments before I/O and bind arrays as ordinary strings, never SQL fragments. */
export function encodePgParameters(input: readonly IPgNativeParameter[]): readonly ISqlValue[] {
  const parameters: ISqlValue[] = []
  for (const value of input) {
    if (value instanceof Uint8Array) {
      /** Native adapters may queue a query across an await before serializing caller bytes. */
      parameters.push(value.slice())
      continue
    }
    if (value !== null && typeof value === 'object') {
      parameters.push(arrayText(value))
      continue
    }
    parameters.push(value)
  }
  return parameters
}
