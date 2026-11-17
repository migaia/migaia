import { memoryTestFeatures } from '../helpers/memory-features.ts'
import { createRuntime } from '@migaia/reactive'
import { records, type IStorageIterator, type IStorageChange } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { expectTypeOf } from 'vitest'
import { reactiveFeature } from '../../src/features/reactive.ts'
import { localStorageBackendPlugin } from '../../src/local-storage.ts'

/** Selecting the Feature adds live only to the existing chain, preserving its selected result. */
const host = await createStorageHost({
  plugins: [
    memoryBackendPlugin({
      name: 'live',
      features: { ...memoryTestFeatures, reactive: reactiveFeature() }
    })
  ]
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
const ordinary = await createStorageHost({
  plugins: [memoryBackendPlugin({ features: memoryTestFeatures })]
})
// @ts-expect-error no live terminal exists without a selected reactive Feature.
ordinary.backend('memory').use(records).query().live({ runtime: createRuntime() })

/** Static watch methods retain runtime admission and never grant organization close ownership. */
const browser = await createStorageHost({ plugins: [localStorageBackendPlugin()] })
/** This original borrowed view shares the native feed but owns only its returned iterator. */
const org = browser.org('00000000-0000-0000-0000-000000000000').backend('local')
expectTypeOf(org.watch('theme')).toEqualTypeOf<IStorageIterator<IStorageChange>>()
// @ts-expect-error borrowed organization views retain no backend disposal authority.
org.dispose()
