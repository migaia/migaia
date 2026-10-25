/** Every new archive error belongs to the archive domain rather than its package spelling. */
export const ERROR_SOURCE = 'storage.backend.archive'
/** Registered archive failures retain their original causes and certainly committed progress. */
export const ArchiveErrorCode = {
  /** Installation options cannot describe a valid archive; fix configuration before reinstalling. */
  invalidOption: 'INVALID_OPTION',
  /** A runtime key, rule or limit is invalid; no cold I/O has started. */
  invalidArgument: 'INVALID_ARGUMENT',
  /** An explicit archive operation failed; retry only after inspecting its cause and progress. */
  operationFailed: 'ARCHIVE_OPERATION_FAILED',
  /** Referenced segment or private metadata failed full validation; repair the stored archive. */
  segmentInvalid: 'ARCHIVE_SEGMENT_INVALID'
} as const
export type IArchiveErrorCode = (typeof ArchiveErrorCode)[keyof typeof ArchiveErrorCode]
