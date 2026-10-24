import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { expect, it } from 'vitest'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'

/** Demand that all six-character fragments are absent from a safe serialized projection. */
function privateProjection(value: string, marker: string): void {
  for (let offset = 0; offset <= marker.length - 6; offset++)
    expect(value.includes(marker.slice(offset, offset + 6))).toBe(false)
}

/**
 * Native bootstrap preserves the historical argv/environment oracle without repeating 50
 * replacements.
 */
it.skipIf(process.platform === 'win32')(
  'actual child argv and environment never carry bootstrap secret',
  async () => {
    /** Synthetic credential is sent exclusively through the existing stdin bootstrap. */
    const marker = randomUUID()
    /**
     * The existing child imports the current isolated build and exercises real control
     * authentication.
     */
    const fixture = new URL('./fixtures/node-child.mjs', import.meta.url).pathname
    /** Production launcher owns process creation and drains the child stderr before hello. */
    const launcher = createNodeProcessLauncher()
    /** One child is sufficient to replay the original secret-boundary oracle. */
    const handle = await launcher.launch(
      {
        command: process.execPath,
        args: [fixture],
        env: { inherit: [], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(marker) }
      },
      { signal: new AbortController().signal, output: () => undefined }
    )
    /** Current public authentication runs before inspecting the live child process metadata. */
    let ready: Awaited<ReturnType<typeof createProcessTransport>> | undefined
    try {
      ready = await createProcessTransport(handle.channel!, {
        role: 'initiator',
        offer: createNativeProcessOffer({ peer: { id: 'parent', runtime: 'node' }, auth: marker }),
        peerId: 'child',
        report: () => undefined,
        ipc: { connectionId: 'eq4-native', sessionId: 'eq4-native', log: () => undefined }
      })
      /** Read the actual OS argv/environment; never print or persist its contents. */
      const metadata = execFileSync(
        'ps',
        ['-E', '-ww', '-o', 'command=', '-p', String(handle.identity.pid)],
        { encoding: 'utf8' }
      )
      privateProjection(metadata, marker)
      privateProjection(inspect(ready, { depth: null, showHidden: true }), marker)
    } finally {
      await ready?.close()
      await handle.terminate('force')
      await handle.exited
    }
  }
)
