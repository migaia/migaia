import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createProcessHost } from '../../src/process/host/client.js'
import { parseProcessPluginDescriptor } from '../../src/process/plugin/descriptor.js'
import { serializeRpcError } from '../../src/contract/error.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { hostFixture } from './fixtures/host-control.js'

/** Demand that all six-character fragments are absent from a safe serialized projection. */
function privateProjection(value: string, marker: string): void {
  for (let offset = 0; offset <= marker.length - 6; offset++)
    expect(value.includes(marker.slice(offset, offset + 6))).toBe(false)
}

/**
 * Historical constructor/getter and descriptor/proxy payloads now follow the repaired privacy
 * contract.
 */
describe('I21 EQ4 historical Host and descriptor sentinel replay', () => {
  it.each(['getter', 'proxy'] as const)(
    'Host %s keeps original cause local and never serializes it',
    (kind) => {
      /** A synthetic random marker prevents an incidental stable text match. */
      const marker = randomUUID()
      /** The precise original instance remains reachable only for local diagnosis. */
      const original = new Error(marker)
      /** No deployment starts after hostile catalog admission fails. */
      const fixture = hostFixture()
      /** Retain both historical failure shapes without exercising unrelated lifecycle probes. */
      const catalog =
        kind === 'getter'
          ? Object.defineProperty({}, 'p', {
              enumerable: true,
              get: () => {
                throw original
              }
            })
          : new Proxy(
              {},
              {
                ownKeys: () => {
                  throw original
                }
              }
            )
      /** Capture current native error instead of using the old expected-leak assertion. */
      let caught: unknown
      try {
        createProcessHost({ ...fixture.options, catalog })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(TypeError)
      expect(caught).toMatchObject({
        source: '@migaia/rpc/remote',
        code: 'REMOTE_CONTRACT_INVALID'
      })
      /** The controlled wrapper intentionally preserves local error identity. */
      const chain: unknown[] = []
      for (let error = caught; error instanceof Error; error = error.cause) chain.push(error)
      expect(chain).toContain(original)
      /** The public wire serializer may not copy that identity-sensitive local cause. */
      const reports: unknown[] = []
      privateProjection(
        JSON.stringify(serializeRpcError(caught, { report: (value) => reports.push(value) })),
        marker
      )
      expect(fixture.launch).not.toHaveBeenCalled()
    }
  )

  it.each(['getter', 'proxy'] as const)(
    'descriptor %s rejects with no hostile cause or diagnostic secret',
    (kind) => {
      /** The historic literal is a synthetic fixture, never a user's credential. */
      const marker = randomUUID()
      /** Reuse the shipped descriptor golden rather than invent a parallel valid shape. */
      const vectors = JSON.parse(
        readFileSync(
          new URL('../../schema/vectors/process-plugin-descriptor.json', import.meta.url),
          'utf8'
        )
      ) as { cases: { id: string; value: Record<string, unknown> }[] }
      /** The production schema vector owns the positive admission baseline. */
      const base = vectors.cases.find((entry) => entry.id === 'spawn-native-stdin')!.value
      /** Snapshot admission encounters the exact getter/ownKeys failures in the original audit. */
      const input =
        kind === 'getter'
          ? Object.defineProperty({ ...base }, 'runtime', {
              enumerable: true,
              get: () => {
                throw new Error(marker)
              }
            })
          : new Proxy(base, {
              ownKeys: () => {
                throw new Error(marker)
              }
            })
      /** No original hostile input is attached to parser errors. */
      let caught: unknown
      try {
        parseProcessPluginDescriptor(input)
      } catch (error) {
        caught = error
      }
      expect(caught).toMatchObject({ code: 'PROCESS_PLUGIN_INVALID_OPTION' })
      expect((caught as Error).cause).toBeUndefined()
      privateProjection(inspect(caught, { depth: null, showHidden: true }), marker)
      privateProjection(
        JSON.stringify(serializeRpcError(caught, { report: () => undefined })),
        marker
      )
    }
  )
})

/**
 * Native bootstrap preserves the historical argv/environment oracle without repeating 50
 * replacements.
 */
it.skipIf(process.platform === 'win32')(
  'I21 EQ4 actual child argv and environment never carry bootstrap secret',
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
