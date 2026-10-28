/** Owns process-local field paths and diagnostics without adding public exports. */

/** Runtime unit label shared by process profiles, admission and structured diagnostics. */
export const PROCESS_KIND = 'process'

/** Stable rejected option paths identify invalid inputs without exposing their values. */
export const ProcessField = {
  budget: 'budget',
  size: 'size',
  report: 'report',
  registry: 'registry',
  prewarm: 'prewarm',
  shutdown: 'shutdown',
  exit: 'exit',
  graceMs: 'graceMs',
  startupTimeoutMs: 'startupTimeoutMs',
  idleTimeoutMs: 'idleTimeoutMs',
  exitTimeoutMs: 'exitTimeoutMs',
  reapTimeoutMs: 'reapTimeoutMs',
  usageIntervalMs: 'usage.intervalMs',
  usageFailureThreshold: 'usage.failureThreshold',
  outputTailBytes: 'output.tailBytes',
  command: 'command',
  args: 'args',
  cwd: 'cwd',
  tmpDir: 'tmpDir',
  env: 'env',
  stdio: 'stdio',
  limits: 'limits',
  permissions: 'permissions',
  bootstrap: 'bootstrap',
  inherit: 'inherit',
  set: 'set',
  envInherit: 'env.inherit',
  envSet: 'env.set',
  stdin: 'stdin',
  stdout: 'stdout',
  stderr: 'stderr',
  stdioStdin: 'stdio.stdin',
  stdioStdout: 'stdio.stdout',
  stdioStderr: 'stdio.stderr',
  via: 'via',
  fd: 'fd',
  payload: 'payload',
  bootstrapPayload: 'bootstrap.payload',
  bootstrapVia: 'bootstrap.via',
  bootstrapFd: 'bootstrap.fd'
} as const

/** Sampling attachment failures share this reason between pool and supervisor diagnostics. */
export const SAMPLE_USAGE_MISSING = 'sample-usage-missing'
/** Native sampling failure diagnostics identify the same usage probe in both entry points. */
export const USAGE_PROBE = 'usage'
/** Recovery failure steps identify the exact operation that left a durable record retained. */
export const RecoveryStep = {
  list: 'list',
  probe: 'probe',
  terminate: 'terminate',
  remove: 'remove'
} as const
/** Process specifications reject NUL characters without ever interpolating input into diagnostics. */
export const NUL_CHARACTER = '\0'

/** Capability diagnostics preserve the stable public option-path spelling. */
export function capabilityField(name: string): string {
  return `launcher.capabilities.${name}`
}
/** Limit diagnostics preserve the stable path while using canonical limit keys. */
export function limitField(name: string): string {
  return `limits.${name}`
}
/** Unknown closed-record fields preserve the original field-path construction. */
export function nestedField(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key
}
