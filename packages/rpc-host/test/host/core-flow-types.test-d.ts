/** Installed namespace extensions remain typed only inside their real transport feature scope. */
import type { IRpcHost, IRpcFanoutResult } from '@migaia/rpc-host'
import {
  defineFlowFeature,
  defineTransportPlugin,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'
import { idempotencyFeature } from '@migaia/rpc-host/plugins/idempotency'
import type { IRpcOutcomeLookupResult } from '@migaia/rpc-contract/protocol'

/** The real feature factory contributes its public lookup only to its owning transport. */
const replay = idempotencyFeature()
/** Each actual generic flow contributes its own disjoint namespace method. */
const extension = defineFlowFeature({
  phase: 1000,
  name: 'typed-extension',
  setup: () => ({ stages: {}, namespaceExtensions: () => ({ answer: () => 42 }) })
})
/** The SDK derives both local extension contributions from the actual transport feature list. */
const memory = defineTransportPlugin({
  name: 'typed-memory',
  namespace: 'memory',
  features: { replay, extension },
  open: () => ({ dispose: () => undefined })
})
/** A different namespace receives no extension from another transport's local features. */
declare const other: IRpcTransportPlugin<'other'>
/** Static projection composes all installed contributions beside the mandatory methods. */
declare const host: IRpcHost<Record<never, never>, readonly [typeof memory, typeof other]>
/** The public query preserves both its discriminated store result and normal fanout result. */
const result: Promise<IRpcOutcomeLookupResult | IRpcFanoutResult<IRpcOutcomeLookupResult>> =
  host.memory.outcome('existing-key')
/** A second flow contribution composes with outcome rather than forming an unusable union. */
const answer: number = host.memory.answer()
void result
void answer
// @ts-expect-error A scoped installation contributes no method to another namespace.
host.other.outcome('existing-key')
// @ts-expect-error Flow extensions cannot escape their owning transport's namespace scope.
host.other.answer()
/** An independent transport with no local feature cannot inherit another declaration's methods. */
declare const plainMemory: IRpcTransportPlugin<'memory'>
/** A host without idempotency has no outcome method in any namespace. */
declare const plain: IRpcHost<Record<never, never>, readonly [typeof plainMemory]>
// @ts-expect-error The optional capability is absent until its actual plugin is installed.
plain.memory.outcome('existing-key')
