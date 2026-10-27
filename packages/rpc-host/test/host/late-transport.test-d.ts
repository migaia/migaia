/** Namespace widening belongs to the awaited use result, not a mutable Host type assertion. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowFeature, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IPluginRemoval } from '@migaia/plugin-host'

/** Literal cold metadata supplies one actual initial namespace. */
const parent = defineTransportPlugin({
  name: 'parent',
  namespace: 'parent',
  open: () => ({ dispose: () => undefined })
})
/** The real local Feature contributes a public extension only to its owning late namespace. */
const extension = defineFlowFeature({
  name: 'late-typed-extension',
  setup: () => ({ stages: {}, namespaceExtensions: () => ({ answer: () => 42 }) })
})
/** Genuine SDK inference carries both the late name and its actual namespace extension. */
const thread = defineTransportPlugin({
  name: 'thread',
  namespace: 'thread',
  features: [extension],
  open: () => ({ dispose: () => undefined })
})

/** This body is checked as a consumer without constructing a test-only runtime host. */
async function lateTransportTypes(): Promise<void> {
  /** Only the genuine cold definition introduces the initial parent namespace. */
  const host = await createRpcHost({ plugins: [parent] })
  host.parent.request('value')
  // @ts-expect-error The original cold Host has not acquired a thread namespace type.
  host.thread.request('value')
  /** The native transaction has no namespace projection until its Promise resolves. */
  const installing = host.use(thread)
  // @ts-expect-error Installation is a Promise, so namespaces are available only after await.
  installing.thread.request('value')
  /** This returned projection carries the original plus actual newly installed definitions. */
  const extended = await installing
  extended.parent.request('value')
  extended.thread.request('value')
  /** The actual local Feature output retains its scalar result type. */
  const answer: number = extended.thread.answer()
  void answer
  // @ts-expect-error Awaiting a new projection does not magically narrow the original variable.
  host.thread.request('value')
  // @ts-expect-error A real late plugin never introduces an unrelated namespace.
  extended.unknownNamespace.request('value')
  // @ts-expect-error Local namespace extensions cannot leak into an earlier transport.
  extended.parent.answer()
  /** Public removal returns the existing plugin-host logical receipt without an RPC wrapper. */
  const removal: IPluginRemoval = await extended.unUse('thread')
  // @ts-expect-error Removal has only the canonical native spelling.
  extended.unuse('thread')
  void removal
  await extended.close()
}
void lateTransportTypes
