import {
  type S3Client,
  type PutObjectCommand,
  type GetObjectCommand,
  type HeadObjectCommand,
  type HeadBucketCommand,
  type ListObjectsV2Command,
  type DeleteObjectCommand,
  type CreateMultipartUploadCommand,
  type UploadPartCommand,
  type CompleteMultipartUploadCommand,
  type AbortMultipartUploadCommand
} from '@aws-sdk/client-s3'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext
} from '@migaia/storage-contract'
import { ObjectErrorCode } from '@migaia/storage-contract/error-code'
import { ObjectNames } from '../constants.js'
import { ObjectErrorText } from '../error-text.js'
import { normalizeObjectError, objectError } from '../errors.js'
import { responseStatus } from './response.js'
/** Only SDK commands used by the object backend can enter its finite native send boundary. */
type ICommand =
  | PutObjectCommand
  | GetObjectCommand
  | HeadObjectCommand
  | HeadBucketCommand
  | ListObjectsV2Command
  | DeleteObjectCommand
  | CreateMultipartUploadCommand
  | UploadPartCommand
  | CompleteMultipartUploadCommand
  | AbortMultipartUploadCommand
/** Canonical SDK middleware identities belong to the supported peer's actual stack protocol. */
const middlewareNames = {
  retry: 'retryMiddleware',
  redirect: 'regionRedirectMiddleware',
  dispatched: 'objectCommitDispatched'
} as const
/**
 * Native writes override retry and region redirect only on this command. Every send passes an
 * explicit options object, preventing the SDK's class-handler cache from bypassing the local
 * stack.
 */
export function createObjectSender(client: S3Client) {
  return async <T>(
    command: ICommand,
    ctx?: IOperationContext,
    mutation = false,
    atomic = false,
    conditional = false
  ): Promise<T> => {
    let dispatched = false
    if (mutation) {
      const stack = command.middlewareStack as PutObjectCommand['middlewareStack']
      stack.add((next) => (args) => next(args), {
        name: middlewareNames.retry,
        step: 'finalizeRequest',
        priority: 'high',
        override: true
      })
      stack.add((next) => (args) => next(args), {
        name: middlewareNames.redirect,
        step: 'initialize',
        override: true
      })
      if (atomic)
        stack.add(
          (next) => (args) => {
            dispatched = true
            return next(args)
          },
          { name: middlewareNames.dispatched, step: 'deserialize', priority: 'low' }
        )
    }
    try {
      return (await client.send(command as PutObjectCommand, {
        abortSignal: ctx?.signal as AbortSignal | undefined
      })) as T
    } catch (cause) {
      const status = responseStatus(cause)
      const name = cause instanceof Error ? cause.name : undefined
      if (
        conditional &&
        (status === 412 ||
          status === 409 ||
          status === 404 ||
          name === 'PreconditionFailed' ||
          name === 'ConditionalRequestConflict')
      )
        throw new StorageContractError(
          StorageContractErrorCode.writeConflict,
          { backend: ObjectNames.backend, cause },
          ObjectErrorText.conflict
        )
      if (conditional && (status === 501 || name === 'NotImplemented'))
        throw new StorageContractError(
          StorageContractErrorCode.unsupported,
          { backend: ObjectNames.backend, cause },
          ObjectErrorText.conditional
        )
      if (atomic && dispatched && status === undefined)
        throw objectError(ObjectErrorCode.commitUnknown, cause)
      if (ctx?.signal?.aborted)
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          backend: ObjectNames.backend,
          cause
        })
      throw normalizeObjectError(cause)
    }
  }
}
