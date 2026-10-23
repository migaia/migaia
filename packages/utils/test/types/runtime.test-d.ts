import type {
  detectElectronProcessType,
  detectGlobalScope,
  detectServerRuntime,
  ElectronProcessType,
  GlobalScopeKind,
  ServerRuntime
} from '@migaia/utils'

/** Compare the complete declared domains without requiring a test framework or host type library. */
type IEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** An incorrect public signature fails compilation at its precise tuple member. */
type IAssert<T extends true> = T

/** Pure ES consumers can import the exact domains and all three public detection signatures. */
export type IRuntimeDeclarations = [
  IAssert<IEqual<ServerRuntime, 'deno' | 'bun' | 'node'>>,
  IAssert<IEqual<ElectronProcessType, 'main' | 'renderer' | 'utility'>>,
  IAssert<
    IEqual<GlobalScopeKind, 'window' | 'dedicated-worker' | 'shared-worker' | 'service-worker'>
  >,
  IAssert<IEqual<typeof detectServerRuntime, () => ServerRuntime | undefined>>,
  IAssert<IEqual<typeof detectElectronProcessType, () => ElectronProcessType | undefined>>,
  IAssert<IEqual<typeof detectGlobalScope, () => GlobalScopeKind | undefined>>
]
