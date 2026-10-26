/**
 * Forwarding process b: owns thread c, child process d, a thread pool p and a coroutine co, and
 * forwards a's calls to them by peer-name prefix.
 */
import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { pool, RPC_POOL_PEER_ID } from '@migaia/rpc-plugin-pool'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { TopologyLeaf } from './topology-leaf.ts'
import {
  HopAuthCounter,
  HopSecret,
  Topology,
  TopologyRecorder,
  topologyLoopMethod,
  type ITopologyOptions
} from './topology-vocabulary.ts'

/** Application options passed by a's process recipe. */
const options = JSON.parse(process.argv[2] ?? '{}') as ITopologyOptions
/** Forward-stage observation of this forwarding host. */
const recorder = new TopologyRecorder()
/** Leaf state of the coroutine; the task shares b's memory. */
const coroutineLeaf = new TopologyLeaf()

/** Coroutine task: a leaf host on the task's own port, open until its signal stops it. */
const coroutineTask: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {
  /** Leaf host bound to this generation's port. */
  const leafHost = await createRpcHost({
    plugins: [coroutineLeaf.recorder.plugin, coroutinePlugin({ connectToParent: connect })],
    provide: coroutineLeaf.providers()
  })
  coroutineLeaf.bind(leafHost.self.instanceId)
  heartbeat()
  try {
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => resolve(), { once: true })
    })
  } finally {
    await leafHost.close()
  }
}

/** Thread entry shared by c and the pool members. */
const threadEntry = new URL('./topology-leaf-thread.ts', import.meta.url)
/** Transform counts of b's side of the b–c auth hop. */
const hopAuth = new HopAuthCounter()
/** Hop-scoped auth installed only on the b–c thread transport. */
const threadFeatures = options.hopAuth ? [auth(hopAuth.options(HopSecret.shared))] : []

/** Cold metadata is reusable; a mismatch is acquired only by the later public use transaction. */
const childThread = threadPlugin({
  name: Topology.c,
  spawn: { entry: threadEntry, data: options },
  features: threadFeatures
})

/** Bootstrap secret for the Python leaf; it travels only through the native launch bootstrap. */
const pythonToken = randomUUID()
/** Python foreign leaf launched like an ML sidecar; it is a leaf and never forwards. */
const pythonPlugins = options.python
  ? [
      processPlugin({
        namespace: 'foreign',
        name: Topology.python,
        spawn: {
          command: 'python3',
          args: [
            '-B',
            fileURLToPath(new URL('../../process/peers/python/peer.py', import.meta.url)),
            '--business',
            '--stdio',
            '--bootstrap',
            'stdin'
          ],
          token: pythonToken
        },
        features: [auth({ credentials: pythonToken })]
      })
    ]
  : []

/** Opening Promise of b; providers await it before touching children. */
const opening: Promise<IRpcHost> = createRpcHost({
  plugins: [
    recorder.plugin,
    processPlugin({ namespace: 'parent', connectToParent: true }),
    ...(options.hopAuth === 'mismatch' ? [] : [childThread]),
    ...(options.childProcess
      ? [
          processPlugin({
            namespace: 'child',
            name: Topology.d,
            spawn: { entry: new URL('./topology-leaf-process.ts', import.meta.url) }
          })
        ]
      : []),
    threadPlugin({
      namespace: 'pool',
      spawn: { entry: threadEntry, data: {} },
      features: [pool({ size: 4 })]
    }),
    coroutinePlugin({ name: Topology.coroutine, spawn: coroutineTask }),
    ...pythonPlugins
  ],
  provide: {
    /** Wait until every child answers its own readiness provider. */
    [Topology.ready]: async () => {
      /** The opened host owning every child namespace. */
      const host = await opening
      await Promise.all([
        ...(options.hopAuth === 'mismatch' ? [] : [host.thread.send(Topology.c, Topology.ready)]),
        ...(options.childProcess ? [host.child.send(Topology.d, Topology.ready)] : []),
        host.pool.send(RPC_POOL_PEER_ID, Topology.ready),
        host.coroutine.send(Topology.coroutine, Topology.ready),
        ...(options.python ? [host.foreign.send(Topology.python, Topology.echo, true)] : [])
      ])
      if (options.loop) {
        /** A real existing leaf method lets c capture b's public loop name before it becomes cyclic. */
        host.provide({
          [Topology.loop]: Reflect.get(host.thread.peers[Topology.c]!, Topology.echo)
        })
        await host.thread.send(Topology.c, Topology.prepareLoop)
        /** C's setup reply does not itself acknowledge processing its independently sent directory. */
        await topologyLoopMethod(host.thread, Topology.c)
      }
      return true
    },
    /** A27 exposes the real public install transaction; its original rejection returns to a. */
    [Topology.installThread]: async () => {
      /** The already opened host keeps its parent, pool and coroutine when this batch fails. */
      const host = await opening
      /** Await the returned namespace projection rather than pretending the original type narrows. */
      const extended = await host.use(childThread)
      await extended.thread.send(Topology.c, Topology.ready)
      return true
    },
    /** Report b's forward rows and each leaf's counters. */
    [Topology.inspect]: async () => {
      /** The opened host owning every child namespace. */
      const host = await opening
      return {
        selfId: host.self.instanceId,
        selfName: host.self.name,
        pid: process.pid,
        forward: recorder.snapshot().filter((event) => event.stage === RpcProbeStage.forward),
        auth: hopAuth.snapshot(),
        ...(options.hopAuth === 'mismatch'
          ? {}
          : { c: await host.thread.send(Topology.c, Topology.inspect) }),
        ...(options.childProcess ? { d: await host.child.send(Topology.d, Topology.inspect) } : {}),
        co: coroutineLeaf.snapshot()
      }
    },
    /** Close b gracefully shortly after replying, while a still has calls in flight. */
    [Topology.shutdown]: async () => {
      /** The opened host to close. */
      const host = await opening
      setTimeout(() => void host.close().then(() => process.exit(0)), 20)
      return true
    }
  }
})
await opening
