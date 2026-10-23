import type { S3Client } from '@aws-sdk/client-s3'
import type {
  IBlobApi,
  IBlobInfo,
  ICapabilityImpl,
  ICapabilityStore,
  IOperationContext,
  IStorageBase,
  IStorageResource
} from '@migaia/storage-contract'
import type { blob } from '@migaia/storage-contract'
import type { ObjectDriverKind } from './constants.js'
/** Descriptor branding is implemented by the package's one private weak identity map. */
declare const objectDriverBrand: unique symbol
/** Lazy driver descriptor never opens directories, clients or upload readers. */
export type IObjectDriver = Readonly<{ kind: ObjectDriverKind; [objectDriverBrand]: true }>
/** Actual object stores grant only the authentic blob capability. */
export type IObjectStore = ICapabilityStore<
  IStorageBase & { readonly backend: 'object' },
  typeof blob,
  readonly [ICapabilityImpl<typeof blob>]
>
/** A confirmed write whose metadata follow-up failed must not be replayed automatically. */
export type IObjectPostCommitError = Error & Readonly<{ committed: true }>
/** Only a Feature receives the already-organized native address. */
export type IObjectAddress = Readonly<{ bucket: string; key: string }>
/** Native data stream and its close callback describe one already-open object snapshot. */
export type IObjectRead = {
  readonly info: IBlobInfo
  readonly source: ReadableStream<Uint8Array>
  readonly close: () => Promise<void>
}
/** Driver pagination uses ordered physical wire keys; the store owns the opaque logical cursor. */
export type IObjectPage = {
  readonly items: readonly { readonly wireKey: string; readonly info: IBlobInfo }[]
  readonly next?: string
}
/** Driver methods are internal native operations and never re-enter public storage pipelines. */
export type IObjectNative = IStorageResource & {
  readonly kind: ObjectDriverKind
  readonly client?: S3Client
  detect(signal: AbortSignal): Promise<void>
  address(key: string): IObjectAddress
  put(
    key: string,
    logicalKey: string,
    body: Parameters<IBlobApi['put']>[1],
    options: NonNullable<Parameters<IBlobApi['put']>[2]>
  ): Promise<IBlobInfo>
  get(
    key: string,
    logicalKey: string,
    options: NonNullable<Parameters<IBlobApi['get']>[1]>
  ): Promise<IObjectRead | undefined>
  head(key: string, logicalKey: string, ctx?: IOperationContext): Promise<IBlobInfo | undefined>
  remove(key: string, ctx?: IOperationContext): Promise<boolean>
  list(
    prefix: string,
    after: string | undefined,
    limit: number,
    ctx?: IOperationContext
  ): Promise<IObjectPage>
}
/** Installation supplies the original lock owner rather than a private driver queue. */
export type IObjectOpenContext = {
  readonly report: (error: unknown) => void
  readonly lock: <T>(
    key: string,
    ctx: IOperationContext | undefined,
    run: () => Promise<T>
  ) => Promise<T>
}
