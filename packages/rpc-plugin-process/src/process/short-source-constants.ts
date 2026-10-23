/** Native short connects wait this long for a named listener to become available. */
export const PROCESS_CONNECT_TIMEOUT_MS = 5000
/** Bounded local rendezvous retries use the existing scheduler, never a second supervisor. */
export const PROCESS_CONNECT_RETRY_MS = 25
/** Unix directory permissions provide the named endpoint's same-user access boundary. */
export const PROCESS_LOCAL_DIRECTORY_MODE = 0o700
/** The owned socket has no group or other-user access, even with a permissive parent umask. */
export const PROCESS_LOCAL_SOCKET_MODE = 0o600
/** Public protocol marker satisfies the existing full-source shape; it is not a secret credential. */
export const PROCESS_LOCAL_AUTH_MARKER = 'migaia-local-same-user'
/** Short Unix paths stay below native socket path limits on macOS and Linux. */
export const PROCESS_LOCAL_DIRECTORY_PREFIX = '/tmp/migaia-rpc-'
/** Named Windows endpoints require an explicit token because this adapter does not configure ACLs. */
export const PROCESS_LOCAL_PIPE_PREFIX = '\\\\.\\pipe\\migaia-rpc-'
/** Stable defaults keep launcher diagnostics and child namespaces within the Process owner. */
export const PROCESS_SHORT_CHILD_NAME = 'process-child'
/** Wrap validation shares one public option path across preparation and per-launch errors. */
export const PROCESS_SHORT_WRAP_FIELD = 'wrap'
