import { TrayInternal } from '../../src/hosts/constants.js'
import { describe, expect, it } from 'vitest'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { assembled, fixture, liveThreads, processAlive, until } from './helper.js'

describe('Tray child topology', () => {
  it.each([0, 1, 2])(
    'runtime %i rejects foreign first init before any business or outlet access',
    async (index) => {
      /** This dispatcher owner is the same implementation used by the real native cases below. */
      const dispatcherUrl = new URL('../../src/hosts/child/dispatch.ts', import.meta.url).href
      /** Runtime declarations remain genuine branded host values. */
      const api = await fixture()
      /** This local genuine Host supplies the same native execution declarations as child serve. */
      const rpc = rpcHostPipelines(
        () => local,
        (name, request) => local.pipeline(name, request)
      )
      /** PluginHost owns Feature activation and the dispatcher registration. */
      const local = defineHost({
        ...rpc,
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      /** Invalid first init must reject before child client construction or RPC access. */
      const dispatcher = (await import(dispatcherUrl)).createChildDispatcher(
        api.hosts[index],
        local,
        () => expect.unreachable('foreign init reached outlet'),
        () => expect.unreachable('foreign init reached exit'),
        () => undefined
      )
      try {
        /** A genuine PluginHost handle supplies the live dispatcher Feature. */
        const installed = await local.use(dispatcher.plugin)
        /** Direct Feature access isolates the first-init guard from the native handshake cases. */
        const control = (installed[0] as any).getFeature('control')
        await expect(
          control.init({ id: 'foreign', host: 'another-host', generation: 1, config: {} })
        ).rejects.toMatchObject({ source: 'tray', code: 'TRAY_CHILD_STATE_INVALID' })
      } finally {
        await local.dispose()
      }
    }
  )
  it.each([0, 1, 2])(
    'runtime %i connects once, validates init and guards double/foreign init and exposure',
    async (index) => {
      /** Fixture declarations and parent assembly share the source host brand. */
      const api = await fixture()
      /** One host declaration owns exactly one runtime family connection. */
      const definition = api.hosts[index]
      /** Existing internal PluginHost is the actual parent connection owner. */
      const { tray, host } = await assembled({ hosts: [definition] })
      /** Native liveness remains independent from discovery state. */
      const beforeThreads = await liveThreads()
      /** Process identity is read from the real child Feature. */
      let pid = 0
      try {
        /** Child config validator adds its output marker only inside init. */
        const remote = await tray.spawn(definition.name, {
          id: 'child',
          config: { label: 'input' }
        })
        /** RPC family accessor comes from the runtime declaration, not a mock transport. */
        const source = host[`${TrayInternal.namespacePrefix}child`]
        const outlet = host[TrayInternal.connection]
        expect((await source.members.list()).connections).toHaveLength(1)
        for (let count = 0; count < 3; count += 1) {
          expect(await remote.request('node.svc.hello')).toMatchObject({
            id: 'child',
            host: definition.name,
            config: { label: 'input', validated: true },
            initCount: 1
          })
        }
        /** Internal call uses the exact topology's trayChild.invoke wire path. */
        const info = await remote.request('node.svc.hello')
        expect(info.generation).toBe((await tray.get('child')).unit.generation)
        pid = info.pid
        await expect(
          outlet.request(TrayInternal.init, {
            id: 'child',
            host: definition.name,
            generation: info.generation
          })
        ).rejects.toMatchObject({ code: 'TRAY_CHILD_STATE_INVALID' })
        await expect(
          outlet.request(TrayInternal.init, {
            id: 'child',
            host: 'foreign',
            generation: info.generation
          })
        ).rejects.toMatchObject({ code: 'TRAY_CHILD_STATE_INVALID' })
        await expect(remote.request('node.hidden.secret')).rejects.toMatchObject({
          source: 'tray',
          code: 'TRAY_PATH_NOT_EXPOSED'
        })
        await tray.remove('child')
        expect(host[`${TrayInternal.namespacePrefix}child`]).toBeUndefined()
        if (definition.runtime === 'thread') expect(await liveThreads()).toEqual(beforeThreads)
        if (definition.runtime === 'process')
          await until(
            () => processAlive(pid),
            (alive) => !alive
          )
      } finally {
        await tray.dispose()
      }
    },
    30000
  )
})
