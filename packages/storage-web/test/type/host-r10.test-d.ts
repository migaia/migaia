import { createStorageHost } from '../../src/host/index.js'
import { memoryReactive } from '../../src/plugins/reactive/memory.js'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()

/** Exact reactive plugin IDs add one backend-specific live-query authority. */
const host = await createStorageHost({
  plugins: [memoryReactive({ id: 'reactive' })] as const
})
void host.backend('reactive').get
const boundQuery = host.reactiveBackend('reactive')?.liveQuery({
  runtime,
  query: ({ store }) => store
})
const rootQuery = host.liveQuery({ backendId: 'reactive', runtime, query: ({ store }) => store })
// @ts-expect-error the live-query state projection is read-only
rootQuery.state.value = host.backend('reactive')
if (boundQuery !== undefined) {
  // @ts-expect-error the backend-bound state projection is read-only
  boundQuery.state.value = host.backend('reactive')
}

/** Widened IDs do not manufacture static capability authority. */
declare const widenedId: string
const widenedHost = await createStorageHost({
  plugins: [memoryReactive({ id: widenedId })] as const
})
// @ts-expect-error widened IDs must not expose a guessed backend key
widenedHost.backend('unknown')
// @ts-expect-error widened IDs must not expose a guessed reactive key
widenedHost.liveQuery({ backendId: 'unknown', runtime, query: () => undefined })
