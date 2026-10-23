/** Stable native layout and operation names are maintained by their object-driver owner. */
export const ObjectNames = {
  backend: 'object',
  s3: 's3',
  fs: 'fs',
  pointer: 'current',
  data: '.data',
  metadata: '.meta',
  temporary: '.tmp',
  version: 1,
  put: 'blob.put',
  get: 'blob.get',
  head: 'blob.head',
  remove: 'blob.remove',
  list: 'blob.list',
  removeByPrefix: 'blob.removeByPrefix',
  presignUpload: 'object.presign.upload',
  presignDownload: 'object.presign.download',
  probe: '.storage-probe/',
  defaultPartBytes: 8 * 1024 * 1024,
  defaultThresholdBytes: 16 * 1024 * 1024,
  defaultPartConcurrency: 4,
  minimumPartBytes: 5 * 1024 * 1024,
  maximumParts: 10000
} as const
/** Public driver-family vocabulary carries no native client or connection authority. */
export const ObjectDriverKind = { s3: 's3', fs: 'fs' } as const
/** Driver-family keys intentionally share their runtime constant namespace. */
export type ObjectDriverKind = keyof typeof ObjectDriverKind
