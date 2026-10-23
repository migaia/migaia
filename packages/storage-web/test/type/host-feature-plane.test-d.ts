import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host'
import { expectTypeOf } from 'vitest'
import { reactiveFeature } from '../../src/features/reactive.js'

/** Selecting the Feature adds live only to the existing chain, preserving its selected result. */
const host = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'live' }, { reactive: reactiveFeature(memoryBackendKind) })]
})
const query = host
  .backend('live')
  .use(records)
  .query<{ name: string; age: number }>()
  .select('name')
  .live({ runtime: createRuntime() })
expectTypeOf(query.state.value.value).toEqualTypeOf<{ name: string }[] | undefined>()
// @ts-expect-error the original Resource projection remains readonly.
query.state.value = { status: 'ready', value: [] }
// @ts-expect-error Feature methods remain on chains, not the store root.
host.backend('live').live({ runtime: createRuntime() })

/** Omitted Features do not manufacture a live terminal or an API result. */
const ordinary = await createStorageHost({ plugins: [memoryBackendPlugin()] })
// @ts-expect-error no live terminal exists without a selected reactive Feature.
ordinary.backend('memory').use(records).query().live({ runtime: createRuntime() })
