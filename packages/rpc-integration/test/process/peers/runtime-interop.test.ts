import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { createRpcByteCarrier, defineTransportPlugin, RpcEventByteIO } from '@migaia/rpc-host/sdk'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { peers, NativeInteropObservations } from './runtime-interop-fixture.js'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { createUnitBudget } from '@migaia/supervision'

/** These existing fixture values remain the original cross-language business baseline. */
const expected = JSON.parse(
  readFileSync(new URL('./ts/public-behavior.json', import.meta.url), 'utf8')
)

/** Only peers implementing the native stdin bootstrap can be spawned by the process plugin. */
for (const fixture of peers.filter((peer) => peer.language !== 'ts-reference')) {
  it(`production TS standard request → ${fixture.language}`, async () => {
    /** Launch credential handed to the child over stdin; the child proves it before Session frames. */
    const token = `native-interop-${fixture.language}`
    /** Only actual remote handshake/flat-error facts enter these assertions. */
    const observed = new NativeInteropObservations()
    /** Observable reports remain local, without recording credentials or frames. */
    const failures: unknown[] = []
    /** The original provided method is the only reverse-execution counter. */
    let reverseCalls = 0
    /** Construct one genuine Host; its supervisor owns and terminates the spawned child. */
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
          spawn: {
            kind: 'spawn',
            channelKind: 'byte',
            token,
            supervision: {
              id: `interop-${fixture.language}`,
              isolation: 'best-effort',
              budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
              report: (error) => failures.push(error),
              restart: { mode: 'never' },
              spec: {
                command: fixture.command,
                args: [...fixture.args, '--stdio', '--bootstrap', 'stdin'],
                env: { inherit: ['PATH'], set: {} },
                stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
                bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
              },
              launcher: createNodeProcessLauncher()
            },
            rawChannel: async (unit) => (unit as INodeProcessHandle).channel!
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
      /** Spawned children receive their identity from the parent's bootstrap. */
      const identity = (await active.process.members.list()).connections[0]?.identity
      assert.ok(identity && 'instanceId' in identity)
      assert.equal(description.self.instanceId, identity.instanceId)
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
      /**
       * Best-effort isolation warns once that native termination is unsupported; nothing else
       * fails.
       */
      expect(failures).toEqual([
        expect.objectContaining({ source: 'supervision', code: 'CAPABILITY_UNSUPPORTED' })
      ])
    } finally {
      await active.close()
    }
  }, 30_000)
}

/** The handwritten reference borrows stdio without the process plugin's bootstrap protocol. */
it('production SDK standard request → ts-reference', async () => {
  /** Existing reference entry remains the independently authored semantic peer. */
  const fixture = peers.find((peer) => peer.language === 'ts-reference')!
  /** This test owns one native child and releases it after the Host's carrier closes. */
  const child = spawn(fixture.command, ['--stdio', '--role', 'responder'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.resume()
  /** Keep protocol reports observable without recording native frames or credentials. */
  const failures: unknown[] = []
  /** Reuse the public SDK's native subscription and write-settlement owner. */
  const io = new RpcEventByteIO(
    child.stdout,
    child.stdin,
    () => {
      child.stdin.end()
    },
    {
      closedError: () => new Error('reference native stream ended'),
      report: (error) => failures.push(error)
    }
  )
  /** The real inbound handshake provides the schema3 directory used for admission. */
  const observed = new NativeInteropObservations()
  /** This native SDK plugin attaches the actual byte carrier, with no process bootstrap shim. */
  const plugin = defineTransportPlugin({
    name: 'reference-native',
    namespace: 'reference',
    /** Public readiness follows the real reference handshake before native ownership returns. */
    async open(context) {
      /** Each direction retains its sole native byte reader. */
      const carrier = createRpcByteCarrier({
        id: 'reference-native',
        io: io.value,
        report: context.report
      })
      await context.attach(carrier, { expectedPeerId: 'ts-peer' }).ready
      return { dispose: () => io.value.close() }
    }
  })
  try {
    /** Construction must negotiate with the executable reference before any request is possible. */
    const active = await createRpcHost({
      self: { name: 'sdk-reference-caller', instanceId: 'sdk-reference-caller' },
      plugins: [observed.plugin, plugin],
      report: (error) => failures.push(error)
    })
    try {
      expect(observed.directory?.schemaVersion).toBe(3)
      expect(observed.directory?.self.instanceId).toBe('ts-peer')
      expect(await active.reference.request('echo', { reference: true })).toEqual({ reference: true })
      expect(
        await Promise.all([active.reference.request('echo', 1), active.reference.request('echo', 2)])
      ).toEqual([1, 2])
      expect(failures).toEqual([])
    } finally {
      await active.close()
    }
  } finally {
    try {
      await io.value.close()
    } finally {
      child.kill()
    }
  }
}, 30_000)
