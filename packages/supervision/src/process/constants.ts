/** Stable stdio modes understood by process launchers. */
export const StdinMode = { channel: 'channel', ignore: 'ignore' } as const
export type StdinMode = (typeof StdinMode)[keyof typeof StdinMode]
/** Stdout may be exposed as a channel, drained, or ignored. */
export const StdoutMode = { channel: 'channel', drain: 'drain', ignore: 'ignore' } as const
export type StdoutMode = (typeof StdoutMode)[keyof typeof StdoutMode]
/** Stderr is drained or ignored. */
export const StderrMode = { drain: 'drain', ignore: 'ignore' } as const
export type StderrMode = (typeof StderrMode)[keyof typeof StderrMode]
/** Stream labels passed to the output sink. */
export const DrainedStream = { stdout: 'stdout', stderr: 'stderr' } as const
export type DrainedStream = (typeof DrainedStream)[keyof typeof DrainedStream]
/** Process-only capability keys, in addition to the shared standard keys. */
export const ProcessCapability = {
  memoryLimit: 'memory-limit',
  cpuTimeLimit: 'cpu-time-limit',
  permissions: 'permissions',
  bootstrapStdin: 'bootstrap-stdin',
  bootstrapFd: 'bootstrap-fd'
} as const
export type ProcessCapability = (typeof ProcessCapability)[keyof typeof ProcessCapability]
/** Limit keys preserve the public specification spelling. */
export const ProcessLimit = {
  memoryBytes: 'memoryBytes',
  cpuTimeMs: 'cpuTimeMs',
  callWallTimeMs: 'callWallTimeMs'
} as const
export type ProcessLimit = (typeof ProcessLimit)[keyof typeof ProcessLimit]
/** Bootstrap carriers which never expose the payload through arguments or environment. */
export const BootstrapVia = { stdin: 'stdin', fd: 'fd' } as const
export type BootstrapVia = (typeof BootstrapVia)[keyof typeof BootstrapVia]
/** Recovery probe must distinguish a reused pid from the original unit. */
export const OrphanProbeResult = { alive: 'alive', gone: 'gone', reused: 'reused' } as const
export type OrphanProbeResult = (typeof OrphanProbeResult)[keyof typeof OrphanProbeResult]
/** Numeric exit outcomes owned by the parent-loss guard. */
export const ParentLossExitCode = { completed: 0, forced: 1 } as const
export type ParentLossExitCode = (typeof ParentLossExitCode)[keyof typeof ParentLossExitCode]
