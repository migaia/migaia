import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fixture, marker } from './helper.js'

describe('Tray external process sandbox', () => {
  it('applies an env command wrapper before init and every restart', async () => {
    /** Wrapper remains caller-owned; Tray introduces no sandbox launcher. */
    const api = await fixture()
    /** The actual launch command passes through /usr/bin/env. */
    const definition = api.defineTrayHost({
      ...api.nodePr,
      sandbox: {
        name: 'env',
        wrap: (command: any) => ({
          ...command,
          command: '/usr/bin/env',
          args: ['TRAY_SANDBOX=env', command.command, ...command.args]
        })
      }
    })
    /** Real child process observes the wrapped environment. */
    const tray = api.createTray({ hosts: [definition] })
    try {
      /** Environment is present before the first generation init runs. */
      const remote = await tray.spawn(definition.name, { id: 'sandbox' })
      expect(await remote.request('node.svc.hello')).toMatchObject({ env: 'env' })
      await tray.restart('sandbox')
      expect(await remote.request('node.svc.hello')).toMatchObject({ env: 'env' })
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))(
    'sandbox-exec denies writes with EPERM while real relayed calls succeed (requires macOS sandbox-exec)',
    async () => {
      /** File path is supplied by config-independent test input, inside the worktree. */
      const destination = marker('denied-write')
      /** Shared process and coroutine hosts communicate through the same Tray relay. */
      const api = await fixture()
      /** Existing OS sandbox is integrated only through the caller command wrapper. */
      const definition = api.defineTrayHost({
        ...api.nodePr,
        sandbox: {
          name: 'sandbox-exec',
          wrap: (command: any) => ({
            ...command,
            command: '/usr/bin/sandbox-exec',
            args: [
              '-p',
              '(version 1)(allow default)(deny file-write*)',
              command.command,
              ...command.args
            ]
          })
        }
      })
      /** Genuine process target runs inside the OS policy. */
      const tray = api.createTray({ hosts: [api.nodeCo, definition] })
      try {
        /** Parent remote invokes the real denied native fs write. */
        const target = await tray.spawn(definition.name, { id: 'sandboxed' })
        /** A separate native coroutine is the relay caller. */
        const caller = await tray.spawn('node-co', { id: 'caller' })
        expect(await target.request('node.svc.tryWrite', destination)).toBe('EPERM')
        expect(
          await caller.request('node.svc.ask', {
            host: 'node-pr',
            id: 'sandboxed',
            value: 'allowed'
          })
        ).toEqual({ id: 'sandboxed', value: 'allowed' })
        expect(existsSync(destination)).toBe(false)
      } finally {
        await tray.dispose()
      }
    },
    30000
  )
})
