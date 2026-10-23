import type { GetObjectCommandOutput, HeadObjectCommandOutput } from '@aws-sdk/client-s3'
import type { IBlobInfo } from '@migaia/storage-contract'
import { objectError } from '../errors.js'
import { ObjectErrorCode } from '../error-code.js'
/** Required native metadata cannot be reconstructed from the local clock or upload request. */
export function responseInfo(
  key: string,
  value: HeadObjectCommandOutput | GetObjectCommandOutput,
  size = value.ContentLength
): IBlobInfo {
  const updatedAt = value.LastModified?.getTime()
  if (
    typeof value.ETag !== 'string' ||
    !Number.isSafeInteger(size) ||
    size! < 0 ||
    updatedAt === undefined ||
    !Number.isFinite(updatedAt)
  )
    throw objectError(ObjectErrorCode.dataInvalid)
  return Object.freeze({
    key,
    size: size!,
    etag: value.ETag,
    contentType: value.ContentType,
    metadata: Object.freeze({ ...value.Metadata }),
    updatedAt
  })
}
/** HTTP status is an explicit service response; absence cannot establish a commit outcome. */
export function responseStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && '$metadata' in error
    ? (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode
    : undefined
}
