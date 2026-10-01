import type {
  IPluginBeforeReleaseContext,
  IPluginDependencyPlan,
  IPluginRemoval,
  PluginHost,
  IHostHandle
} from '../src/index.js'

type IEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type IAssert<T extends true> = T

/** Type-only oracle for both public unUse receivers and the relative release budget. */
export const checkUnUseTypes = (
  handle: IHostHandle<Record<string, never>, never, readonly []>,
  host: PluginHost<Record<string, never>>,
  context: IPluginBeforeReleaseContext,
  wide: boolean
) => {
  const fromHandle = handle.unUse('a')
  const fromClass = host.unUse('a', { policy: 'suspend' })
  const plan = handle.unUse('a', { dryRun: true })
  const remaining: number | undefined = context.remainingMs()
  // @ts-expect-error a broad boolean cannot select one literal overload
  handle.unUse('a', { dryRun: wide })
  void remaining
  type IA = IAssert<IEqual<typeof fromHandle, Promise<IPluginRemoval>>>
  type IB = IAssert<IEqual<typeof fromClass, Promise<IPluginRemoval>>>
  type IC = IAssert<IEqual<typeof plan, Promise<IPluginDependencyPlan>>>
  return null as unknown as [IA, IB, IC]
}
