// Client page of the platform fixture: the application's own entry. It installs the remote plugin
// against the catalog given as `?service=`, caches versions in IndexedDB, grants the notify effect a
// restricted tier, and forwards production errors to an in-page log-host output.
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import { createPartHost, definePart, definePartPlugin } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { bindReactComponent, reactPlugin } from '@migaia/part-plugin-react'
import { forwardPartErrors, remotePlugin } from '@migaia/part-plugin-remote'
import { defineFeature } from '@migaia/plugin-host/features'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import config from '../partom.config.ts'
import { chunks, manifest, shared } from '../src/partom-client.gen.ts'

/** Records forwarded by `forwardPartErrors`, read by the test. */
const reports: unknown[] = []

/** Log host whose only output keeps records on the page. */
const log = createLogHost({
  plugins: [
    levelPlugin(),
    defineOutputPlugin({
      name: 'page',
      batchable: false,
      defaultFormat: 'plain',
      deliver: (records) => void reports.push(...records.map((record) => record.entry.args[0]))
    })
  ]
})

/** Part whose component always throws, to show production error reports. */
const boom = definePart({ id: 'boom@1' })

/** Plugin with the throwing part. */
const boomPlugin = definePartPlugin({
  name: 'boom',
  parts: [boom],
  implementations: [
    bindReactComponent(boom, () => {
      throw new Error('boom')
    })
  ]
})

/** IndexedDB cache of versions and module bytes. */
const storage = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'orders-client' })]
})

/** Remote delivery plugin. */
const remote = remotePlugin({
  service: new URLSearchParams(location.search).get('service') ?? '',
  project: 'orders',
  env: 'dev',
  manifest,
  shared,
  chunks,
  cache: storage.backend('indexed-db') as never,
  trust: { 'effects/notify.ts': { tier: 'restricted', grants: { state: ['page.notice'] } } },
  revalidateMs: 3600000
})

/** Holder of the remote Feature for the test. */
const exposed: { remote?: unknown } = {}

/** Plugin exposing Feature `remote`. */
const probe = definePartPlugin({
  name: 'client-probe',
  features: {
    remote: defineFeature((_core, deps: { readonly remote: unknown }) => deps.remote, {
      remote: (remote as unknown as { getFeature(name: string): unknown }).getFeature('remote')
    } as never)
  },
  onInstall: (features) => void (exposed.remote = features.remote)
})

/** Config plugins without the DOM and React plugins added first. */
const own = (config.plugins as { name: string }[]).filter(
  (plugin) => plugin.name !== domPlugin.name && plugin.name !== reactPlugin.name
)

/** Client host. */
const host = await createPartHost({
  plugins: [domPlugin, reactPlugin, ...(own as never[]), boomPlugin, remote, probe],
  onError: forwardPartErrors(log)
})
await (exposed.remote as { ready(): Promise<void> }).ready()
host.mount(document.getElementById('app'), 'orders-page')
await host.blueprint.load({ id: 'boom', version: 1, root: { tag: 'boom@1', id: 'boom' } })
host.mount(document.getElementById('boom'), 'boom')
;(globalThis as Record<string, unknown>).__client = { remote: exposed.remote, reports, log }
