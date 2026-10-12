/** Stable devtools diagnostics; consumers must classify codes rather than parse these messages. */
export const RpcDevtoolsErrorText = {
  /** Root factory placeholder remains terminal until the collector replaces it (contract S6). */
  collectorNotInstalled: 'rpc devtools collector runtime not installed',
  /** Hub factory placeholder remains terminal until the hub replaces it (contract S6). */
  hubNotInstalled: 'rpc devtools hub runtime not installed',
  /** Codec boundary reports malformed records while retaining the original failure on cause (R4). */
  recordFormatInvalid: 'invalid rpc devtools record',
  /** Header validation requires the one frozen version and format marker (contract §5). */
  recordHeaderInvalid: 'rpc devtools record header must identify format version 1',
  /** Event lines retain the required service event fields so imported records remain usable (R4). */
  recordEventInvalid: 'rpc devtools record event fields are invalid',
  /** The record byte tag uses canonical padded Base64; repair a malformed payload before import. */
  recordBytesInvalid: 'rpc devtools record bytes must be canonical base64'
} as const
