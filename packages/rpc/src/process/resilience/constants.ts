/** One default governance owner admits a bounded number of physical connections. */
export const DEFAULT_MAX_CONNECTIONS = 64
/** A connection gets its own endpoint, so global and per-peer admission share this limit. */
export const DEFAULT_MAX_CONCURRENT_CALLS = 32
/** Per-connection minute windows use the injected monotonic scheduler. */
export const DEFAULT_MAX_CALLS_PER_MINUTE = 600
/** Payload admission remains below the channel's independent frame bound. */
export const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
/** Repeated timeouts close only the affected connection, not its shared instance. */
export const DEFAULT_MAX_CONSECUTIVE_TIMEOUTS = 3
/** Native endpoint pings occur only after startup has published an endpoint. */
export const DEFAULT_HEALTH_INTERVAL_MS = 5_000
/** Supervision owns this deadline and aborts the ping signal when it expires. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000
/** Three failed native checks promote one unit to unhealthy. */
export const DEFAULT_HEALTH_FAILURE_THRESHOLD = 3
/** No inbound frames or in-flight work for this period makes a session idle. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000
/** Close control gives existing requests time to settle before physical release. */
export { DEFAULT_DRAIN_MS } from '../../remote/constants.js'
/** Diagnostic reports are relative to each entry into terminal. */
export const DEFAULT_REPORT_AT_MS = Object.freeze([0, 60_000, 300_000, 900_000])
/** The fourth unhandled report starts liquidation under the default policy. */
export const DEFAULT_UNHANDLED_LIMIT = 3
/** Terminal history remains bounded while one registration is alive. */
export const MAX_LIQUIDATION_TOMBSTONES = 100
