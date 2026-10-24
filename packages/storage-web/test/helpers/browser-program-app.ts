import { createStorageHost, createOrgId, definePlugin } from '@migaia/storage-host'
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
    runStorageProgramApplication(): Promise<{
      application: IStorageProgramResult
      logged: boolean
      observations: Record<string, number[]>
      batch: Awaited<ReturnType<typeof runStorageProgramBatch>>
      organizations: Awaited<ReturnType<typeof runStorageProgramOrgs>>
    }>
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
    plugins: [indexedDbBackendPlugin({ dbName: 'program-' + crypto.randomUUID() }), observed],
    hooks: {
      beforeStorageOperation: ({ operation }) => events.push('before:' + operation),
      afterStorageOperation: ({ operation }) => events.push('after:' + operation),
      onStorageOperationError: ({ operation }) => events.push('error:' + operation)
    },
    journal: { logger, namespace: 'program' }
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
      plugins: [indexedDbBackendPlugin({ dbName: 'program-org-' + crypto.randomUUID() })]
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
