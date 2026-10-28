/** A public native removal and a genuine arriving connection share the original Feature lifetime. */
import { defineHost } from '@migaia/plugin-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { defineFlowFeature, rpcFlowPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { expect, it } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

it('F3 refuses a new connection or shared Auth removal while its accepted cleanup is pending', async () => {
  /** Cleanup entry proves native removal was accepted before the new physical connection starts. */
  const entered = deferred<void>()
  /** The original Feature disposer owns the open removal interval, including failure cleanup. */
  const released = deferred<void>()
  /** This real shared Feature contributes no replacement stage, queue or admission authority. */
  const held = defineFlowFeature({
    name: 'f3-held-shared-cleanup',
    setup: () => ({
      dispose: async () => {
        entered.resolve()
        await released.promise
      }
    })
  })
  /** Both Features use the ordinary SDK wrapper and its actual native registration lifetime. */
  const flows = rpcFlowPlugin([auth({ sign: (value) => value, verify: (value) => value }), held])
  /** Only this native Host lends candidate and committed pipeline execution authority. */
  const rpc = rpcHostPipelines(
    () => host,
    (name, request) => host.pipeline(name, request)
  )
  /** No Session exists when the wrapper's original removal admission runs. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The existing listener retains its genuine public attachment port throughout removal. */
  const server = coreMemoryServer('f3-removal-server')
  /** Every real rejection is observed immediately, without changing its native error object. */
  let removing: Promise<PromiseSettledResult<Awaited<ReturnType<typeof host.unUse>>>> | undefined
  /** A successful connection still owns its original public cleanup receipt. */
  let client: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    await host.use(flows)
    await host.use(server.transport)
    removing = Promise.allSettled([host.unUse(flows.name)]).then(([outcome]) => outcome!)
    await Promise.race([
      entered.promise,
      removing.then((outcome) => {
        if (outcome.status === 'rejected') throw outcome.reason
        expect.fail('shared removal settled before the original held Feature cleanup')
      })
    ])
    /** The opposite public Host completes real signed handshakes while that disposer stays held. */
    const [connection] = await Promise.allSettled([
      server.connect('f3-arriving-client', {
        plugins: [auth({ sign: (value) => value, verify: (value) => value })]
      })
    ])
    if (connection!.status === 'fulfilled') client = connection.value
    released.resolve()
    /** Native cleanup keeps its original result or rejection after the held interval ends. */
    const removal = await removing
    expect({
      connected: connection!.status === 'fulfilled',
      removed: removal.status === 'fulfilled' && removal.value.ok
    }).not.toEqual({ connected: true, removed: true })
    if (connection!.status === 'rejected')
      expect(connection.reason).toMatchObject({
        source: expect.any(String),
        code: expect.any(String)
      })
    if (removal.status === 'rejected')
      expect(removal.reason).toMatchObject({ source: expect.any(String), code: expect.any(String) })
    else if (!removal.value.ok)
      for (const error of removal.value.errors)
        expect(error).toMatchObject({ source: expect.any(String), code: expect.any(String) })
  } finally {
    released.resolve()
    await removing
    await client?.host.close()
    await host.dispose()
  }
})
