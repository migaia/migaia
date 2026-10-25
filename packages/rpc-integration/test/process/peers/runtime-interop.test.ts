import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { peers, NativeInteropObservations } from './runtime-interop-fixture.js'
import { createNodeProcessLauncher } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'

/** These existing fixture values remain the original cross-language business baseline. */
const expected = JSON.parse(
  readFileSync(new URL('./ts/public-behavior.json', import.meta.url), 'utf8')
)

for (const fixture of peers) {
  it(`production TS standard request → ${fixture.language}`, async () => {
    /** The test retains the original child owner; Host borrows only the same native stdio channel. */
    const launcher = createNodeProcessLauncher()
    /** A failed preparation still leaves child termination with this test. */
    const handle = await launcher.launch(
      {
        command: fixture.command,
        args: [...fixture.args, '--stdio'],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
      },
      { signal: new AbortController().signal, output: () => undefined }
    )
    /** Only actual remote handshake/flat-error facts enter these assertions. */
    const observed = new NativeInteropObservations()
    /** Observable reports remain local, without recording credentials or frames. */
    const failures: unknown[] = []
    /** The original provided method is the only reverse-execution counter. */
    let reverseCalls = 0
    /** Construct one genuine Host; the borrowed recipe returns exactly the original raw channel. */
    try {
      const opening = createRpcHost({
        self: { name: 'production-ts', instanceId: 'production-ts-1' },
        provide: {
          parentEcho: (payload: unknown) => {
            reverseCalls += 1
            return payload
          }
        },
        plugins: [
          observed.plugin,
          processPlugin({
            name: fixture.language,
            connect: {
              target: {
                kind: 'connect',
                address: 'native-stdio',
                /** This public configuration marker is not a credential or an auth success claim. */
                token: 'native-interop-local-recipe',
                dial: async () => handle.channel!
              }
            }
          })
        ],
        report: (error) => failures.push(error)
      })
      /** The accepted schema3 directory comes from the same physical Session used by these calls. */
      const active = await opening
      try {
        const description = observed.directory!
        assert.equal(description.schemaVersion, 3)
        assert.equal(description.self.instanceId, fixture.id)
        assert.ok(
          description.methods.some(
            (method) => method.name === 'echo' && method.supportedModes.includes('request')
          )
        )
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(await active.process.request('echo', { language: fixture.language }))
          ),
          { language: fixture.language }
        )
        assert.deepEqual(
          await Promise.all([active.process.request('echo', 1), active.process.request('echo', 2)]),
          [1, 2]
        )
        if (fixture.language === 'python') {
          assert.deepEqual(
            JSON.parse(
              JSON.stringify(
                await active.process.request('peer.reverse', {
                  method: 'parentEcho',
                  payload: { reverse: true }
                })
              )
            ),
            { reverse: true }
          )
          assert.equal(reverseCalls, 1)
          /** Original shared business cancellation assertions now reach the true Python reader. */
          const controller = new AbortController()
          /** The same live Session carries the held request, original reason and later request. */
          const waiting = active.process.request('peer.wait', [], { signal: controller.signal })
          await new Promise((resolve) => setTimeout(resolve, 20))
          controller.abort(new RangeError(expected.cancel.reason))
          await expect(waiting).rejects.toMatchObject({ code: expected.cancel.expectedCode })
          expect(await active.process.request('peer.aborts', [])).toMatchObject([
            expected.cancel.providerReason
          ])
          expect(await active.process.request('p.f.request', ['after-cancel'])).toBe('after-cancel')
          /** Preserve every original semantic error assertion while the wire becomes a flat graph. */
          let receivedError: unknown
          await expect(
            active.process.request('peer.error', []).catch((error) => {
              receivedError = error
              throw error
            })
          ).rejects.toMatchObject(expected.error)
          expect(receivedError).toBeInstanceOf(Error)
          const failedWire = observed.error
          expect(failedWire).toBeDefined()
          assert.equal(failedWire!.root, 0)
          assert.equal(failedWire!.nodes[0]!.cause, 1)
          /** BC11 removes only the local scalar wrapper; both original wire nodes remain exact. */
          const restored = receivedError as Record<string, unknown> & {
            cause: Record<string, unknown>
          }
          for (const field of ['source', 'code', 'name', 'message', 'stack'] as const) {
            assert.equal(restored[field], failedWire!.nodes[0]![field])
            assert.equal(restored.cause[field], failedWire!.nodes[1]![field])
          }
        } else assert.equal(reverseCalls, 0)
        assert.equal(failures.length, 0)
      } finally {
        await active.close()
      }
    } finally {
      handle.terminate('force')
      await handle.exited
    }
  }, 30_000)
}
