/** Public warning codes describe successful construction decisions and are never error codes. */
export const RpcWarningCode = {
  /** The actual native parent supplied the name, overriding an explicit child self.name. */
  selfIgnored: 'SELF_IGNORED'
} as const

export type RpcWarningCode = (typeof RpcWarningCode)[keyof typeof RpcWarningCode]

/** One native identity decision carries both names without exposing launch credentials. */
export type IRpcWarning = Readonly<{
  code: RpcWarningCode
  message: string
  data: Readonly<{
    parentName: string
    ignoredName: string
  }>
}>

/** The default warning channel remains separate from the configured background error reporter. */
export function defaultRpcWarning(warning: IRpcWarning): void {
  console.warn(warning)
}
