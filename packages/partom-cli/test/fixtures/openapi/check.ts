// Copied next to the generated `src/api` by the import test; prints what the generated code did.
import { createPartHost } from '@migaia/part-host'
import { apiPlugin, createHttpPlugin } from './src/api/index.ts'

/** Requests the generated client sent. */
const requests: string[] = []

/** Fake fetch recording method and URL path with query. */
function fakeFetch(input: URL | RequestInfo, init?: RequestInit): Promise<Response> {
  /** Request URL. */
  const url = new URL(String(input))
  requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
  return Promise.resolve(new Response(init?.method === 'DELETE' ? '' : '[]', { status: 200 }))
}

/** Host with the generated plugins. */
const host = await createPartHost({
  plugins: [
    createHttpPlugin({ baseUrl: 'http://api.test/', fetch: fakeFetch as typeof fetch }),
    apiPlugin
  ]
})
/** Model validation of an empty customer. */
const invalid = await host.models.validate('order@1', { id: '1', customer: '' })
/** Descriptor of the order model. */
const model = host.catalog.get('order@1')?.descriptor
/** Watch of the list. */
const watch = host.resources.watch({ $resource: 'list-orders@1', params: { status: 'open' } })
await new Promise((resolve) => setTimeout(resolve, 20))
host.state.runtime.flush()
await host.resources.run('list-orders@1', 'deleteOrder', { id: 'a/b' })
await new Promise((resolve) => setTimeout(resolve, 20))
host.state.runtime.flush()
console.log(
  JSON.stringify({
    invalid,
    key: model?.model?.key,
    createdAt: model?.model?.display?.createdAt,
    requests,
    status: watch.read().status
  })
)
watch.release()
await host.dispose()
