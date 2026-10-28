import type { IBlobApi } from '@migaia/storage-contract'
import { invalidArgument } from '../errors.ts'
/** S3 HTTP metadata keys are lowercase HTTP tokens; values must fit ordinary HTTP header bytes. */
export function assertS3ObjectHeaders(options: NonNullable<Parameters<IBlobApi['put']>[2]>): void {
  if (
    Object.entries(options.metadata ?? {}).some(
      ([name, value]) => !/^[!#$%&'*+.^_`|~a-z0-9-]+$/.test(name) || /[^\t\x20-\x7e]/.test(value)
    ) ||
    (options.contentType !== undefined && /[^\t\x20-\x7e]/.test(options.contentType))
  )
    throw invalidArgument()
}
