import { definePlugin, PluginHost, type IPluginConstraint } from '../src/index.js'
import type { IPluginSetup, IPluginSetupContext, IPluginSetupOperation } from '@migaia/plugin-host'

/** Requires structural equality in both directions, including the setup output axis. */
type IEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type IAssert<T extends true> = T

declare const setupType: IPluginSetup<Record<string, never>, number>
declare const setupContext: IPluginSetupContext
declare const setupOperation: IPluginSetupOperation
void setupType
void setupContext
void setupOperation

const withSetup = definePlugin({
  name: 'p',
  setup: async (context) => {
    context.operation.now()
    context.onDispose(() => {})
    // @ts-expect-error Setup has no Feature outputs before construction.
    void context.features
    // @ts-expect-error Setup cannot register a pipeline stage.
    void context.usePipeline
    return { n: 1 }
  },
  featureExpose: (_core, out) => {
    type IOut = IAssert<IEqual<typeof out, { n: number }>>
    return { read: () => out.n as IOut extends true ? number : never }
  },
  install: (core, out) => {
    type IOut = IAssert<IEqual<typeof out, { n: number }>>
    return {
      value: () => (core.featureExpose.read() + out.n) as IOut extends true ? number : never
    }
  }
})
type ISetupArity = IAssert<IEqual<Parameters<typeof withSetup.install>['length'], 2>>
declare const setupArity: ISetupArity
void setupArity

const noSetup = definePlugin({ name: 'q', install: () => ({ plain: () => 1 }) })
type IPlainArity = IAssert<IEqual<Parameters<typeof noSetup.install>['length'], 1>>
declare const plainArity: IPlainArity
void plainArity
const one: 1 = (undefined as unknown as Parameters<typeof noSetup.install>).length
void one
// @ts-expect-error A plain hook has exactly one declared parameter.
const two: 2 = (undefined as unknown as Parameters<typeof noSetup.install>).length
void two

definePlugin({
  name: 'bad-install',
  // @ts-expect-error A two-argument install requires a declared setup.
  install: (_core, _out: number) => ({})
})
// @ts-expect-error A two-argument featureExpose requires a declared setup.
definePlugin({
  name: 'bad-expose',
  featureExpose: (_core: unknown, _out: { k: string }) => ({ k: () => 1 }),
  install: () => ({})
})

declare const host: PluginHost<Record<string, never>>
// @ts-expect-error Raw plain definitions cannot receive a setup output.
host.use({ name: 'raw-install', install: (_core: unknown, _out: number) => ({}) })
// @ts-expect-error Raw plain feature exposure cannot receive a setup output.
host.use({
  name: 'raw-expose',
  featureExpose: (_core: unknown, _out: number) => ({ read: () => 1 }),
  install: () => ({})
})
// @ts-expect-error Replacement cannot add a second hook argument without setup.
host.replace('q', { name: 'q', install: (_core: unknown, _out: number) => ({}) })
const [rawHandle] = await host.use({
  name: 'raw-setup',
  setup: () => 1,
  install: (_core: unknown, out: number) => ({ o: out })
})
type IRawExt = IAssert<IEqual<typeof rawHandle.extensions, Readonly<{ o: number }>>>
declare const rawExt: IRawExt
void rawExt

const [setupHandle, plainHandle] = await host.use(withSetup, noSetup)
type ISetupExt = IAssert<IEqual<typeof setupHandle.extensions, Readonly<{ value: () => number }>>>
type IPlainExt = IAssert<IEqual<typeof plainHandle.extensions, Readonly<{ plain: () => 1 }>>>
declare const setupExt: ISetupExt
declare const plainExt: IPlainExt
void setupExt
void plainExt

declare const generic: IPluginConstraint<any>
generic.install({} as never)

definePlugin(
  'functional',
  () => ({ install: () => ({}) }),
  undefined,
  // @ts-expect-error Functional definitions do not accept a fourth setup argument.
  () => 1
)
