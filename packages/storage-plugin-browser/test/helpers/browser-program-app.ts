import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { entityTestFeatures } from './entity-features.js'
import { storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { indexedDbTestFeatures } from './indexed-db-features.js'
import { createStorageHost, createOrgId, definePlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import {
  runStorageProgramApp,
  runStorageProgramBatch,
  createStorageProgramJournal,
  runStorageProgramOrgs,
  storageProgramBatchObservations,
  type IStorageProgramResult
} from '../../../storage-plugin-sqlite/test/helpers/program-app.js'

declare global {
  /** Declaration merging exposes the unchanged public application to the existing browser runner. */
  interface Window {
    runStorageProgramAutomaticIndex(): Promise<{
      ids: string[]
      groups: string[]
      readsAfterExplain: number[]
      readsAfterQuery: number[]
      selectedIndex: string | undefined
      fullScan: boolean
      secondaryIndexes: boolean
    }>
    runStorageProgramApplication(): Promise<{
      application: IStorageProgramResult
      logged: boolean
      observations: Record<string, number[]>
      batch: Awaited<ReturnType<typeof runStorageProgramBatch>>
      organizations: Awaited<ReturnType<typeof runStorageProgramOrgs>>
    }>
  }
}

/** Real IndexedDB proves the declared equality index narrows the actual query reader. */
window.runStorageProgramAutomaticIndex = async () => {
  /** Observe the original entity query stage rather than estimating native candidate counts. */
  const readCounts: number[] = []
  /** A fresh physical database keeps the twelve fixture rows independent of other cases. */
  const host = await createStorageHost({
    plugins: [
      storageProbe({
        afterQuery: ({ stats }) => readCounts.push(stats.readCount)
      }),
      storageJournalPlugin(),
      indexedDbBackendPlugin(
        { dbName: 'program-index-' + crypto.randomUUID() },
        indexedDbTestFeatures
      )
    ]
  })
  try {
    /** The real browser backend owns both index readiness and the native lookup cursor. */
    const store = host.backend('indexed-db')
    /** The declared path is the only index available to the automatic source selector. */
    const repo = defineEntity<{ id: string; group: string }>()({
      features: entityTestFeatures,
      name: 'program-automatic-index',
      key: 'id',
      indexes: { byGroup: { path: 'group' } }
    }).connect(store, { queryStages: host.queryStages(store) })
    for (let index = 0; index < 12; index++)
      await repo.put({ id: String(index), group: index % 2 ? 'one' : 'two' })
    // Use the repository's existing migration/readiness path before measuring the lookup.
    await repo.migrate()
    await repo.query().index('byGroup').all()
    readCounts.length = 0
    /** No explicit index call participates in the query being measured. */
    const query = repo.query().where({ group: 'one' })
    /** Static selection remains conservative about fallback while doing no query work. */
    const plan = query.explain()
    /** Capture observations before execution so later stages cannot alter this evidence. */
    const readsAfterExplain = [...readCounts]
    /** Native equality lookup must examine only the six matching index candidates. */
    const rows = await query.requirePushdown().all()
    return {
      ids: rows.map((row) => row.id),
      groups: rows.map((row) => row.group),
      readsAfterExplain,
      readsAfterQuery: [...readCounts],
      selectedIndex: plan.index,
      fullScan: plan.fullScan,
      secondaryIndexes: store.capabilities.secondaryIndexes
    }
  } finally {
    await host.dispose()
  }
}

/** Real Chromium and WebKit use the same application module as the native service consumers. */
window.runStorageProgramApplication = async () => {
  const { logs, logger } = createStorageProgramJournal()
  const pipelines: string[] = [],
    events: string[] = []
  const observed = definePlugin('program-observer', (core) => ({
    install() {
      core.useAsyncPipeline((input, next) => {
        pipelines.push(input.operation)
        return next(input)
      })
      return {}
    }
  }))
  const host = await createStorageHost({
    org: createOrgId(),
    plugins: [
      storageProbe({
        beforeStorageOperation: ({ operation }) => events.push('before:' + operation),
        afterStorageOperation: ({ operation }) => events.push('after:' + operation),
        onStorageOperationError: ({ operation }) => events.push('error:' + operation)
      }),
      storageJournalPlugin({ logger, namespace: 'program' }),
      indexedDbBackendPlugin({ dbName: 'program-' + crypto.randomUUID() }, indexedDbTestFeatures),
      observed
    ]
  })
  try {
    const store = host.backend('indexed-db')
    const application = await runStorageProgramApp(store)
    const logged = (await logs.read(1, 100)).some((row) => row.kind === 'storage.commit')
    pipelines.length = 0
    events.length = 0
    const batch = await runStorageProgramBatch(store)
    const observations = storageProgramBatchObservations(pipelines, events)
    await host.dispose()
    const plain = await createStorageHost({
      org: createOrgId(),
      plugins: [
        storageJournalPlugin(),
        indexedDbBackendPlugin(
          { dbName: 'program-org-' + crypto.randomUUID() },
          indexedDbTestFeatures
        )
      ]
    })
    let organizations: Awaited<ReturnType<typeof runStorageProgramOrgs>>
    try {
      const one = createOrgId(),
        two = createOrgId()
      organizations = await runStorageProgramOrgs(
        plain.backend('indexed-db'),
        plain.org(one).backend('indexed-db'),
        plain.org(two).backend('indexed-db'),
        () => plain.dropOrg(one)
      )
    } finally {
      await plain.dispose()
    }
    return { application, logged, batch, organizations, observations }
  } finally {
    await host.dispose()
    await logger.shutdown('manual')
  }
}
