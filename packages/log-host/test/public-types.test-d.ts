import { expectTypeOf } from 'vitest'
import { createLogHost, levelPlugin, LogHostStatus } from '../src/index.ts'
import { defineOutputPlugin, defineLogFeature } from '../src/plugin.ts'
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
  features: [
    defineLogFeature({ kind: 'gate', phase: 'gate', accept: acceptAll }),
    defineLogFeature({ kind: 'format', phase: 'format', format: formatAll })
  ],
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
defineLogFeature({ kind: 'delivery', phase: 'delivery' })
// @ts-expect-error A complete entry feature must provide its stage implementation.
defineLogFeature({ kind: 'entry', phase: 'entry' })
// @ts-expect-error Structural descriptors do not possess the private factory identity.
const forgedEntry: ILogFeature = { kind: 'entry', phase: 'entry', stage: (entry) => entry }
// @ts-expect-error A public delivery-looking object cannot manufacture private issuance.
const forgedDelivery: ILogFeature = { kind: 'batch', phase: 'delivery' }
// @ts-expect-error The retired status spelling has no compatibility alias.
const retiredStatus: LogHostStatus = 'shutting-down'
void forgedEntry
void forgedDelivery
void retiredStatus

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
