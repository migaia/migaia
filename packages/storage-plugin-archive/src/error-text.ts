/** Registered failure text excludes business keys, values and archive contents. */
export const ArchiveText = Object.freeze({
  INVALID_OPTION: 'Archive options are invalid',
  INVALID_ARGUMENT: 'Archive argument is invalid',
  ARCHIVE_OPERATION_FAILED: 'Archive operation failed',
  ARCHIVE_SEGMENT_INVALID: 'Archive segment is invalid',
  unsupported: 'Archive requires transactional records, external I/O and gzip blob storage'
})
