/** Object-driver errors belong to the registered storage backend domain. */
export const ERROR_SOURCE = 'storage.backend.object'
/** Native object failure categories preserve the original cause and actual commit boundary. */
export const ObjectErrorCode = {
  /** Object I/O, signing or resource release failed; inspect cause before deciding whether to retry. */
  failed: 'OBJECT_FAILED',
  /** Stored pointer, sidecar or required native response is corrupt; do not treat it as missing. */
  dataInvalid: 'OBJECT_DATA_INVALID',
  /** The atomic commit was sent but acknowledgment is unknown; inspect head instead of replaying. */
  commitUnknown: 'OBJECT_COMMIT_UNKNOWN'
} as const
/** Stable union used by every native error constructor. */
export type IObjectErrorCode = (typeof ObjectErrorCode)[keyof typeof ObjectErrorCode]
