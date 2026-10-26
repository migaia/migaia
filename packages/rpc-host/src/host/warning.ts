/** Public warning codes describe successful construction decisions and are never error codes. */
export const RpcWarningCode = {
  /** The native parent overrode an explicitly configured child name or instance address. */
  selfIgnored: 'SELF_IGNORED'
} as const

export type RpcWarningCode = (typeof RpcWarningCode)[keyof typeof RpcWarningCode]

/** Native identity warnings include only the values actually ignored, never launch credentials. */
export type IRpcWarning = Readonly<{
  code: RpcWarningCode
  message: string
  data: Readonly<{
    parentName?: string
    ignoredName?: string
    parentInstanceId?: string
    ignoredInstanceId?: string
  }>
}>

/** The default warning channel remains separate from the configured background error reporter. */
export function defaultRpcWarning(warning: IRpcWarning): void {
  console.warn(warning)
}
