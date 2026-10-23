import { describe, expect, it, onTestFinished } from 'vitest'
import { runConformance, type IConformanceHarness } from '@migaia/storage-contract/conformance'
import { kv, records, ttl, counter, vector, rdf, blob } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin } from '../../src/index.js'

/** The owning package consumes the one public suite with its complete real native manifest. */
const harness: IConformanceHarness = { describe, expect, it }
runConformance(harness, {
  name: 'native memory complete conformance',
  capabilities: [kv, records, ttl, counter, vector, rdf, blob],
  features: {
    syncRead: true,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    secondaryIndexes: false,
    changeFeed: true,
    maxValueBytes: undefined,
    opaqueEntries: false
  },
  create: async () => {
    /** Every case receives an empty original host; its owner also releases registration resources. */
    const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    onTestFinished(() => host.dispose())
    return host.backend('memory')
  }
})
