import { expectTypeOf } from 'vitest'
import { createLogHost, levelPlugin, LogHostStatus } from '../src/index.ts'
import { defineOutputPlugin, defineLogFeature, defineLogPlugin } from '../src/plugin.ts'
import { filterFeature, thresholdFeature, uuidFeature } from '../src/features/index.ts'
import type { ILogPluginCore, ILogFeature, ILevelPluginExt } from '../src/typing.ts'
import type { IPluginRemoval } from '@migaia/plugin-host'

/** The first common usage must infer level extension methods without a type assertion. */
const levelHost = createLogHost({ plugins: [levelPlugin()] })
expectTypeOf(levelHost.info).toEqualTypeOf<ILevelPluginExt['info']>()
levelHost.info('message', { value: 1 })

/** Named extension state keeps callback shape rules separate from the public generic check. */
class CustomMethods {
  /** A real core proves the generic factory is compatible with current peer declarations. */
  #core: ILogPluginCore
  /** Capture the installed registration without a replacement peer type. */
  constructor(core: ILogPluginCore) {
    this.#core = core
  }
  /** Stable custom extension demonstrates exact inference of an ordinary public method. */
  readonly custom = (message: string): number => {
    this.#core.log('custom', message)
    return message.length
  }
}
/** Installation returns a concrete extension rather than annotating away its inferred shape. */
function installCustom(core: ILogPluginCore) {
  return { custom: new CustomMethods(core).custom }
}
/** Output transport itself needs no extra capabilities in this compile-only scenario. */
function deliverCustom(): void {}
/** The second common usage retains custom extension return values and legal SDK descriptors. */
const output = defineOutputPlugin({
  name: 'custom',
  batchable: true,
  defaultFormat: 'json',
  features: {
    defineLog: defineLogFeature({ phase: 'gate', accept: acceptAll }),
    defineLog1: defineLogFeature({ phase: 'format', format: formatAll })
  },
  install: installCustom,
  deliver: deliverCustom
})
/** Legal gate signature uses the real feature definition without implicit any. */
function acceptAll(): boolean {
  return true
}
/** Legal format signature returns text without a replacement descriptor type. */
function formatAll(): string {
  return 'text'
}
/** Extension inference survives the same host boundary used by real consumers. */
const customHost = createLogHost({ plugins: [output] })
expectTypeOf(customHost.custom('message')).toEqualTypeOf<number>()
expectTypeOf(customHost.unUse('custom')).toEqualTypeOf<Promise<IPluginRemoval>>()

/** The third common usage preserves each member of a dynamically installed tuple. */
async function dynamicTuple(): Promise<void> {
  /** The original variable's type stays unchanged while each returned handle retains its extension. */
  const host = createLogHost()
  /** Input order and exact extension methods remain visible on the peer-issued handle tuple. */
  const handles = await host.use(levelPlugin(), output)
  expectTypeOf(handles[0].extensions.info).toEqualTypeOf<ILevelPluginExt['info']>()
  expectTypeOf(handles[1].extensions.custom).returns.toEqualTypeOf<number>()
}
void dynamicTuple

/** Every key=value constant remains assignable to the public status type. */
const statuses: LogHostStatus[] = [
  LogHostStatus.active,
  LogHostStatus.flushing,
  LogHostStatus.shuttingDown,
  LogHostStatus.closed
]
void statuses
// @ts-expect-error Third parties cannot define the internal delivery phase.
defineLogFeature({ phase: 'delivery' })
// @ts-expect-error A complete entry feature must provide its stage implementation.
defineLogFeature({ phase: 'entry' })
defineLogFeature({
  // @ts-expect-error Feature names belong to record keys; kind is not a definition field.
  kind: 'retired-name',
  phase: 'gate',
  accept: acceptAll
})
// @ts-expect-error Structural descriptors do not possess plugin-host native feature identity.
const forgedEntry: ILogFeature = { phase: 'entry', stage: (entry) => entry }
// @ts-expect-error A public delivery-looking object cannot manufacture native issuance.
const forgedDelivery: ILogFeature = { phase: 'delivery' }
// @ts-expect-error The retired status spelling has no compatibility alias.
const retiredStatus: LogHostStatus = 'shutting-down'
void forgedEntry
void forgedDelivery
void retiredStatus

/** BC1–BC3: record declarations keep controls inferred on the plugin's host extensions. */
const policy = defineLogPlugin({
  name: 'policy',
  features: { threshold: thresholdFeature(), filter: filterFeature() }
})
/** Actual installed extensions preserve exact input and removal types. */
const policyHost = createLogHost({ plugins: [policy] })
policyHost.policy_threshold_setLevel('warn')
expectTypeOf(policyHost.policy_filter_add(acceptAll)).toEqualTypeOf<() => void>()
// @ts-expect-error Features enter through declaring plugins, never through host options.
createLogHost({ features: { uuid: uuidFeature() } })
defineLogPlugin({
  name: 'array-rejected',
  // @ts-expect-error Native feature declarations use a named record, not an array.
  features: [filterFeature()]
})
/** Native feature definitions have no public runtime fields or controls. */
const opaqueFilter = filterFeature()
// @ts-expect-error Filter controls belong to an installed plugin extension.
opaqueFilter.add(acceptAll)
// @ts-expect-error Definition tokens expose no descriptor fields.
void opaqueFilter.phase
// @ts-expect-error Entry implementations are installed, never read from a token.
void uuidFeature().stage

defineOutputPlugin({
  name: 'array-output-rejected',
  batchable: true,
  defaultFormat: 'json',
  // @ts-expect-error Output plugins use the same native record declaration form.
  features: [filterFeature()],
  deliver: deliverCustom
})

/** The text-free branch keeps entry/signal and rejects fields that were deliberately not produced. */
const entryOnly = defineOutputPlugin({
  name: 'entry-only',
  batchable: true,
  consumesText: false,
  install: installCustom,
  deliver(records, context) {
    expectTypeOf(records[0].entry.message).toEqualTypeOf<string>()
    expectTypeOf(context.signal).toEqualTypeOf<AbortSignal>()
    // @ts-expect-error An entry-only transport does not receive fabricated text.
    void records[0].text
    // @ts-expect-error An entry-only context does not select a format descriptor.
    void context.format
  }
})
/** Adding the discriminant must preserve the existing install extension inference. */
const entryOnlyHost = createLogHost({ plugins: [entryOnly] })
expectTypeOf(entryOnlyHost.custom('message')).toEqualTypeOf<number>()

defineOutputPlugin({
  name: 'invalid-default',
  batchable: true,
  consumesText: false,
  // @ts-expect-error A text-free definition cannot specify a default text format.
  defaultFormat: 'json',
  deliver: deliverCustom
})

/** Existing text consumers retain definite text and selected-format values without narrowing. */
defineOutputPlugin({
  name: 'text-output',
  batchable: true,
  defaultFormat: 'plain',
  deliver(records, context) {
    expectTypeOf(records[0].text).toEqualTypeOf<string>()
    expectTypeOf(context.format.phase).toEqualTypeOf<'format'>()
  }
})
