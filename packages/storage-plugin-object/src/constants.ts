/** Stable native layout and operation names are maintained by their object-driver owner. */
export const ObjectNames = {
  /** Backend kind name registered with storage-host and stamped on errors; stable public identity. */
  backend: 'object',
  /** Driver family name for the S3-compatible client; recorded in layout metadata. */
  s3: 's3',
  /** Driver family name for the local filesystem; recorded in layout metadata. */
  fs: 'fs',
  /** Persisted name of the per-key pointer file that names the current committed data version. */
  pointer: 'current',
  /** Persisted suffix of committed data objects; existing stores depend on it. */
  data: '.data',
  /** Persisted suffix of metadata sidecar objects next to each data object. */
  metadata: '.meta',
  /** Persisted suffix of in-flight uploads; cleanup recognizes leftovers by it. */
  temporary: '.tmp',
  /** On-disk layout version written into metadata; readers reject other versions. */
  version: 1,
  /** Operation name of blob.put for host pipelines, observation and concurrency. */
  put: 'blob.put',
  /** Operation name of blob.get for host pipelines and observation. */
  get: 'blob.get',
  /** Operation name of blob.head for host pipelines and observation. */
  head: 'blob.head',
  /** Operation name of blob.remove for host pipelines and observation. */
  remove: 'blob.remove',
  /** Operation name of blob.list; batch observation treats it as unbounded. */
  list: 'blob.list',
  /** Operation name of blob.removeByPrefix; batch observation treats it as unbounded. */
  removeByPrefix: 'blob.removeByPrefix',
  /** Feature operation name observed when signing an upload URL. */
  presignUpload: 'object.presign.upload',
  /** Feature operation name observed when signing a download URL. */
  presignDownload: 'object.presign.download',
  /** Key prefix of the conditional-write capability probe object written at open. */
  probe: '.storage-probe/',
  /** Default multipart part size (8 MiB) when the caller sets none. */
  defaultPartBytes: 8 * 1024 * 1024,
  /** Default body size (16 MiB) at or above which uploads switch to multipart. */
  defaultThresholdBytes: 16 * 1024 * 1024,
  /** Default number of multipart parts in flight. */
  defaultPartConcurrency: 4,
  /** S3 minimum multipart part size (5 MiB); smaller configured sizes are rejected. */
  minimumPartBytes: 5 * 1024 * 1024,
  /** S3 maximum number of parts per multipart upload. */
  maximumParts: 10000
} as const
/** Public driver-family vocabulary carries no native client or connection authority. */
export const ObjectDriverKind = { s3: 's3', fs: 'fs' } as const
/** Driver-family keys intentionally share their runtime constant namespace. */
export type ObjectDriverKind = keyof typeof ObjectDriverKind
