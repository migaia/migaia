import { memoryNotificationsFeature } from '../../src/features/memory-notifications.ts'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.ts'
import { describe, expect, it, onTestFinished } from 'vitest'
import { runConformance, type IConformanceHarness } from '@migaia/storage-contract/conformance'
import { kv, records, ttl, counter, vector, rdf, blob } from '@migaia/storage-contract'
import { createStorageHost } from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'

/** The owning package consumes the one public suite with its complete real native manifest. */
const harness: IConformanceHarness = { describe, expect, it }
runConformance(harness, {
  name: 'native memory complete conformance',
  capabilities: [kv, records, ttl, counter, vector, rdf, blob],
  features: {
    batch: true,
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
    const host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    onTestFinished(() => host.dispose())
    return host.backend('memory')
  }
})
