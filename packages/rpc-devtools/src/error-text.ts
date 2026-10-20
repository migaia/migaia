/** Stable devtools diagnostics; consumers must classify codes rather than parse these messages. */
export const RpcDevtoolsErrorText = {
  /** Portable service conversion retains the original failure on cause for the remote caller. */
  serviceResultInvalid: 'rpc devtools service result cannot be encoded',
  /** Root factory placeholder remains terminal until the collector replaces it. */
  collectorNotInstalled: 'rpc devtools collector runtime not installed',
  /** Hub factory placeholder remains terminal until the hub replaces it. */
  hubNotInstalled: 'rpc devtools hub runtime not installed',
  /** Codec boundary reports malformed records while retaining the original failure on cause. */
  recordFormatInvalid: 'invalid rpc devtools record',
  /** Header validation requires the one frozen version and format marker (contract). */
  recordHeaderInvalid: 'rpc devtools record header must identify format version 1',
  /** Event lines retain the required service event fields so imported records remain usable. */
  recordEventInvalid: 'rpc devtools record event fields are invalid',
  /** The record byte tag uses canonical padded Base64; repair a malformed payload before import. */
  recordBytesInvalid: 'rpc devtools record bytes must be canonical base64'
} as const
