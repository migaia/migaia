/** Installed namespace extensions remain typed only inside their real cold plugin scope. */
import type { IRpcHost, IRpcFanoutResult } from '@migaia/rpc-host'
import { defineFlowPlugin, type IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import type { IRpcOutcomeLookupResult } from '@migaia/rpc-contract/protocol'

/** The actual transport metadata introduces these two independent namespaces. */
declare const memory: IRpcTransportPlugin<'memory'>
/** A different namespace receives no extension from the explicitly scoped plugin. */
declare const other: IRpcTransportPlugin<'other'>
/** The real factory must retain its literal namespace scope in its return type. */
const replay = idempotency({ namespaces: ['memory'] })
/** Each actual generic flow contributes its own disjoint namespace method. */
const extension = defineFlowPlugin({
  name: 'typed-extension',
  namespaces: ['memory'],
  setup: () => ({ hooks: {}, namespaceExtensions: () => ({ answer: () => 42 }) })
})
/** Static projection composes all installed contributions beside the mandatory methods. */
declare const host: IRpcHost<
  Record<never, never>,
  readonly [typeof memory, typeof other, typeof replay, typeof extension]
>
/** The public query preserves both its discriminated store result and normal fanout result. */
const result: Promise<IRpcOutcomeLookupResult | IRpcFanoutResult<IRpcOutcomeLookupResult>> =
  host.memory.outcome('existing-key')
/** A second flow contribution composes with outcome rather than forming an unusable union. */
const answer: number = host.memory.answer()
void result
void answer
// @ts-expect-error A scoped installation contributes no method to another namespace.
host.other.outcome('existing-key')
// @ts-expect-error Flow extensions cannot escape their explicit namespace scope.
host.other.answer()
/** A host without idempotency has no outcome method in any namespace. */
declare const plain: IRpcHost<Record<never, never>, readonly [typeof memory]>
// @ts-expect-error The optional capability is absent until its actual plugin is installed.
plain.memory.outcome('existing-key')
