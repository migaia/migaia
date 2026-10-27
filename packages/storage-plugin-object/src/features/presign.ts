import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  defineFeature,
  type IStorageFeatureCallContext,
  type IStorageFeatureExpose,
  type IStorageFeatureOutput
} from '@migaia/storage-host'
import { snapshotStorageBlobPut, snapshotStorageBlobGet } from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext
} from '@migaia/storage-contract'
import type { IObjectStore } from '../types.js'
import { ObjectDriverKind, ObjectNames } from '../constants.js'
import { objectBackendKind } from '../plugin.js'
import { invalidArgument, normalizeObjectError } from '../errors.js'
import { observeObjectFeature } from '../store.js'
import { assertS3ObjectHeaders } from '../s3/options.js'
/** Signed requests expose only URL/method and the exact headers the caller must carry. */
export type IObjectSignedRequest<TMethod extends 'GET' | 'PUT'> = Readonly<{
  url: string
  method: TMethod
  headers: Readonly<Record<string, string>>
}>
/** Upload URLs retain the same content, metadata and mutually exclusive condition inputs as put. */
export type IObjectPresignUploadOptions = {
  readonly expiresInSeconds?: number
  readonly contentType?: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly ifMatch?: string
  readonly ifNoneMatch?: true
  readonly ctx?: IOperationContext
}
/** Download URLs can restrict native inclusive byte ranges. */
export type IObjectPresignDownloadOptions = {
  readonly expiresInSeconds?: number
  readonly range?: { readonly start: number; readonly end?: number }
  readonly ctx?: IOperationContext
}
/** Signing performs no upload/download and grants no transaction projection or client ownership. */
export type IObjectPresignApi = {
  upload(key: string, options?: IObjectPresignUploadOptions): Promise<IObjectSignedRequest<'PUT'>>
  download(
    key: string,
    options?: IObjectPresignDownloadOptions
  ): Promise<IObjectSignedRequest<'GET'>>
}
/** HTTP names used by signed requests and the SDK's optional empty-body checksum calculation. */
const Headers = {
  contentType: 'content-type',
  metadata: 'x-amz-meta-',
  ifMatch: 'if-match',
  ifNoneMatch: 'if-none-match',
  range: 'range',
  checksum: 'x-amz-checksum-crc32',
  algorithm: 'x-amz-sdk-checksum-algorithm'
} as const
/** The SDK accepts seconds through seven days; actual credentials may expire sooner. */
const expiry = (value: number | undefined): number => {
  const seconds = value === undefined ? 900 : value
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800) throw invalidArgument()
  return seconds
}
/** Use the official signer and the installed S3 client; the root entry never imports this Feature. */
export function objectPresignFeature() {
  return defineFeature<
    typeof objectBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      {},
      { readonly store: { readonly presign: IObjectPresignApi }; readonly transaction: {} }
    >
  >(objectBackendKind, (core) => {
    if (core.featureExpose.getDriverKind() !== ObjectDriverKind.s3)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: ObjectNames.backend
      })
    return {
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          presign: {
            async upload(
              key: string,
              options?: IObjectPresignUploadOptions
            ): Promise<IObjectSignedRequest<'PUT'>> {
              return signObjectUpload(core.featureExpose, this, key, options)
            },
            async download(
              key: string,
              options?: IObjectPresignDownloadOptions
            ): Promise<IObjectSignedRequest<'GET'>> {
              return signObjectDownload(core.featureExpose, this, key, options)
            }
          }
        },
        transaction: {}
      }
    }
  })
}

/** Invocation context belongs to the host and carries the fixed organized store view. */
type IObjectSigningCall = IStorageFeatureCallContext<S3Client | undefined, IObjectStore>
/** The existing backend feature port supplies addresses and the borrowed native signer client. */
type IObjectSigningPort = IStorageFeatureExpose<typeof objectBackendKind>

/**
 * Sign one upload with explicit native and invocation context; options stay stable across async
 * credential resolution.
 */
async function signObjectUpload(
  native: IObjectSigningPort,
  call: IObjectSigningCall,
  key: string,
  options?: IObjectPresignUploadOptions
): Promise<IObjectSignedRequest<'PUT'>> {
  const captured = snapshotStorageBlobPut(key, new Uint8Array(0), options, ObjectNames.backend)
  const seconds = expiry(options?.expiresInSeconds)
  assertS3ObjectHeaders(captured.options)
  return observeObjectFeature(
    call.store,
    ObjectNames.presignUpload,
    captured.options.ctx,
    async () => {
      const address = native.getObjectAddress(captured.key, {
        ...captured.options.ctx,
        orgId: call.orgId
      })
      const headers: Record<string, string> = Object.fromEntries(
        Object.entries(captured.options.metadata ?? {}).map(([name, value]) => [
          Headers.metadata + name,
          value
        ])
      )
      if (captured.options.contentType !== undefined)
        headers[Headers.contentType] = captured.options.contentType
      if (captured.options.ifMatch !== undefined)
        headers[Headers.ifMatch] = captured.options.ifMatch
      if (captured.options.ifNoneMatch) headers[Headers.ifNoneMatch] = '*'
      const command = new PutObjectCommand({
        Bucket: address.bucket,
        Key: address.key,
        ContentType: captured.options.contentType,
        Metadata: captured.options.metadata,
        IfMatch: captured.options.ifMatch,
        IfNoneMatch: captured.options.ifNoneMatch ? '*' : undefined
      })
      /** The future caller body is unknown; never sign the SDK's computed empty-body CRC32. */
      const stripUnspecifiedBodyChecksum: Parameters<
        PutObjectCommand['middlewareStack']['add']
      >[0] = (next) => (args) => {
        const request = args.request as { headers: Record<string, string> }
        delete request.headers[Headers.checksum]
        delete request.headers[Headers.algorithm]
        return next(args)
      }
      command.middlewareStack.addRelativeTo(stripUnspecifiedBodyChecksum, {
        name: 'objectPresignBodyUnspecified',
        relation: 'before',
        toMiddleware: 'presignInterceptMiddleware'
      })
      try {
        const url = await getSignedUrl(native.getS3Client(), command, {
          expiresIn: seconds,
          unhoistableHeaders: new Set(Object.keys(headers)),
          signableHeaders: new Set(Object.keys(headers))
        })
        return { url, method: 'PUT', headers: headers }
      } catch (error) {
        throw normalizeObjectError(error)
      }
    }
  )
}

/**
 * Sign one download with explicit native and invocation context; options stay stable across async
 * credential resolution.
 */
async function signObjectDownload(
  native: IObjectSigningPort,
  call: IObjectSigningCall,
  key: string,
  options?: IObjectPresignDownloadOptions
): Promise<IObjectSignedRequest<'GET'>> {
  const captured = snapshotStorageBlobGet(key, options, ObjectNames.backend)
  const seconds = expiry(options?.expiresInSeconds)
  return observeObjectFeature(
    call.store,
    ObjectNames.presignDownload,
    captured.options.ctx,
    async () => {
      const address = native.getObjectAddress(captured.key, {
        ...captured.options.ctx,
        orgId: call.orgId
      })
      const headers: Record<string, string> = {}
      if (captured.options.range)
        headers[Headers.range] =
          `bytes=${captured.options.range.start}-${captured.options.range.end ?? ''}`
      try {
        const url = await getSignedUrl(
          native.getS3Client(),
          new GetObjectCommand({
            Bucket: address.bucket,
            Key: address.key,
            Range: headers[Headers.range]
          }),
          { expiresIn: seconds, signableHeaders: new Set(Object.keys(headers)) }
        )
        return { url, method: 'GET', headers: headers }
      } catch (error) {
        throw normalizeObjectError(error)
      }
    }
  )
}
