import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createRpcStreamFrameDecoder } from '../../src/contract/framing/stream.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { readRuntimePeerConnection, type IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { peers } from '../process/fixtures/conformance-business.js'
import { createProcessPlugin } from '../../src/process/index.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'

/** U36 uses the independent new-baseline peers, including the handwritten TS oracle. */
for (const peer of [
  ...peers.filter((peer) => ['python', 'go', 'rust'].includes(peer.language)),
  {
    language: 'ts-reference',
    command: 'sh',
    args: [new URL('../process/peers/ts-reference/run.sh', import.meta.url).pathname],
    id: 'ts-peer'
  }
]) {
  it(`[A32/A112] ${peer.language} uses v2/batch and receives a forwarded call without route`, async () => {
    /** B owns the real process connection; A only sees B's explicit transparent method. */
    const owners = [
      runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      }),
      runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
    ] as const
    /** This actual second connection establishes A-to-B independently of the foreign process. */
    const carrier = runtimeSources()
    /** Actual process ownership stays with the existing builtin launcher and its exit receipt. */
    const launcher = createNodeProcessLauncher()
    /** Only this test owns and terminates its child; the new Peer owns the borrowed byte endpoint. */
    let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
    /** Frame observation retains method names alone, excluding auth and all business payloads. */
    const methods: string[] = []
    /** Count route fields on the physical foreign wire, including members of a real batch. */
    let routedFrames = 0
    /** Actual negotiated capabilities are copied after the independent foreign handshake. */
    let capabilities: readonly string[] = []
    /** A registered reverse provider remains idle until explicitly called. */
    let hiddenCalls = 0
    /** Preparation diagnostics remain local; no secret-bearing frames enter saved output. */
    const failures: unknown[] = []
    /** Construction failure still leaves the real child in this test's cleanup ownership. */
    let active: IRuntimePeer | undefined
    try {
      /** The unchanged peer executes its own real native handshake and business dispatcher. */
      await owners[1].use(
        createProcessPlugin({
          name: 'c',
          self: { name: 'caller', instanceId: 'caller' },
          provide: {
            hidden: () => {
              hiddenCalls += 1
              return 'hidden'
            }
          },
          connect: async (context) => {
            handle = await launcher.launch(
              {
                command: peer.command,
                args: [...peer.args, '--stdio'],
                env: { inherit: ['PATH'], set: {} },
                stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
              },
              { signal: new AbortController().signal, output: () => undefined }
            )
            /**
             * One observer reuses the published decoder; it implements no RPC receiver or
             * dispatcher.
             */
            const decoder = createRpcStreamFrameDecoder({
              onFrame(frame) {
                /** Method spelling proves v2 discovery without retaining business payloads. */
                const decoded = JSON.parse(new TextDecoder().decode(frame))
                for (const value of Array.isArray(decoded) ? decoded : [decoded]) {
                  if (value.method !== undefined) methods.push(value.method)
                  if (value.data?.route?.forwardRoute !== undefined) routedFrames += 1
                }
              },
              onError(error) {
                throw error
              }
            })
            /**
             * Capture the native writer through an arrow and preserve the original transport
             * completion.
             */
            const raw = handle.channel!
            /** Only declared canonical endpoint capabilities enter the initiator's actual offer. */
            const offer = createNativeProcessOffer({
              peer: { id: context.self.instanceId, runtime: 'node' }
            })
            /** The original process handshake still owns authentication and capability intersection. */
            const channel = await createProcessTransport(
              {
                ...raw,
                write: (frame) => {
                  decoder.push(frame)
                  return raw.write(frame)
                }
              },
              {
                role: 'initiator',
                peerId: peer.id,
                offer: { ...offer, capabilities: context.capabilities },
                ipc: {
                  connectionId: `a32-${peer.language}`,
                  sessionId: `a32-${peer.language}`,
                  log: () => undefined
                },
                report: (error) => {
                  failures.push(error)
                }
              }
            )
            capabilities = channel.agreement.capabilities
            return channel
          },
          report: (error) => {
            failures.push(error)
          }
        })
      )
      active = readRuntimeOutletConnection(owners[1].process, 'c')!.peer
      /** The accepted v2 directory describes the actual remote provider whitelist. */
      const description = readRuntimePeerConnection(active).description!
      assert.equal(description.schemaVersion, 2)
      assert.equal(description.self.instanceId, peer.id)
      assert.ok(description.methods.some((method) => method.name === 'echo'))
      assert.equal(await active.request('echo', 'baseline-ready'), 'baseline-ready')
      assert.deepEqual(
        await Promise.all([active.request('echo', 1), active.request('echo', 2)]),
        [1, 2]
      )
      assert.equal(capabilities.includes(RpcCapability.runtimeApi), true)
      assert.equal(capabilities.includes(RpcCapability.batch), true)
      assert.equal(capabilities.includes(RpcCapability.forwardRoute), false)
      assert.equal(description.nodeId, undefined)
      /** Start both original Plugin sources concurrently without a replacement receiver owner. */
      await Promise.all([
        owners[0].use(
          createThreadPlugin({
            name: 'b',
            self: { name: 'a', instanceId: 'a-forward-caller' },
            connect: carrier.sources[0],
            report: (error) => failures.push(error)
          })
        ),
        owners[1].use(
          createThreadPlugin({
            name: 'a',
            self: { name: 'b', instanceId: 'b-forward-caller' },
            expose: ['c.echo', 'c.peer.error'],
            connect: carrier.sources[1],
            report: (error) => failures.push(error)
          })
        )
      ])
      assert.equal(
        await owners[0].thread!.request('b', 'c.echo', 'forward-terminal'),
        'forward-terminal'
      )
      assert.equal(routedFrames, 0, '[A112] the foreign physical wire never carries route')
      /** Foreign terminals omit wire extensions, but B must retain its already known prefix. */
      const knownRoute = [
        readRuntimePeerConnection(readRuntimeOutletConnection(owners[0].thread, 'b')!.peer)
          .directory.localDescription.nodeId,
        readRuntimePeerConnection(readRuntimeOutletConnection(owners[1].thread, 'a')!.peer)
          .directory.localDescription.nodeId
      ]
      /** The independent language's direct error is the oracle for its exact stack and chain. */
      let original: any
      await assert.rejects(active.request('peer.error'), (error: any) => {
        original = error.cause ?? error
        return true
      })
      await assert.rejects(owners[0].thread!.request('b', 'c.peer.error'), (error: any) => {
        assert.equal(error.source, original.source)
        assert.equal(error.code, original.code)
        assert.equal(error.stack, original.stack)
        assert.equal(error.cause?.stack, original.cause?.stack)
        assert.deepEqual(error.route, knownRoute, '[A107/A112] the known native prefix survives')
        return true
      })
      assert.equal(routedFrames, 0, '[A112] failing foreign frames also omit route')
      assert.equal(hiddenCalls, 0)
      assert.equal(methods.includes(RemoteMethodName.runtimeDescribe), true)
      assert.equal(methods.includes(RemoteMethodName.describe), false)
      assert.ok(failures.every((error: any) => error.code === 'INTERNAL'))
    } finally {
      try {
        for (const host of owners) await host.dispose()
        carrier.close()
      } finally {
        handle?.terminate('force')
        await handle?.exited
      }
    }
  }, 30_000)
}
