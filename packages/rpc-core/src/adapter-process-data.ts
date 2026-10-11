/**
 * Existing native launch/bootstrap configuration uses these stable protocol data values. This
 * module contains no registration, proof reader, context setter or resource operation.
 */
export {
  PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  PROCESS_RUNTIME_API_ENV,
  PROCESS_RUNTIME_API_ENV_VERSION,
  PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
  PROCESS_RUNTIME_API_FINGERPRINT_PREFIX,
  PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
} from './adapter-owned/process/constants.js'
