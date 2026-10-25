import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { detectServerRuntime, walkErrorCauses } from '@migaia/utils'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createWebThreadLauncher,
  createWebThreadChannelFactory
} from '../../../dist/threads/web-launcher.js'

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: {
      echo: (value: string) => value,
      sequence: async function* () {
        yield 1
        yield 2
      }
    },
    report: () => undefined
  })
} else {
  /** These are the actual native launcher declarations consumed by this one original supervisor. */
  const reports: unknown[] = []
  const launcher = createWebThreadLauncher({ report: (error) => reports.push(error) })
  const host = await createRpcHost({
    plugins: [
      threadPlugin({
        spawn: {
          entry: new URL(import.meta.url),
          launcher,
          channelFactory: createWebThreadChannelFactory({
            scheduler: systemScheduler,
            report: (error) => reports.push(error)
          }),
          supervisor: { stop: { reapTimeoutMs: 2000 } }
        }
      })
    ],
    report: (error) => reports.push(error)
  })
  const value = await host.thread.request('echo', 'native-worker')
  const values: unknown[] = []
  for await (const item of host.thread.stream('sequence') as AsyncIterable<unknown>)
    values.push(item)
  await host.close()
  await host.close()
  console.log(
    JSON.stringify({
      runtime: detectServerRuntime(),
      value,
      values,
      capabilities: launcher.capabilities,
      reports: reports.flatMap((error) =>
        walkErrorCauses(error).map((value) => {
          const error = value as {
            source?: string
            code?: string
            name?: string
            reason?: unknown
            detail?: unknown
            message?: string
          }
          return {
            source: error.source ?? null,
            code: error.code ?? null,
            name: error.name ?? null,
            reason: error.reason ?? null,
            detail: error.detail ?? null,
            message: error.message ?? String(value)
          }
        })
      )
    })
  )
}
