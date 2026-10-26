/**
 * Forwarding process b: owns thread c, child process d, a thread pool p and a coroutine co, and
 * forwards a's calls to them by peer-name prefix.
 */
import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import {
  createRpcHost,
  defaultRpcReporter,
  type IRpcHost,
  type IRpcNamespace
} from '@migaia/rpc-host'
import { rpcFlowPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
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

/** Configure the same four native namespace groups before any resource is acquired. */
function isolatedNativeHost() {
  /** The SDK borrows this actual Host's pipeline authority only after construction. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['parent', 'thread', 'pool', 'coroutine']
  )
  /** Separate native use calls commit independent application installation transactions. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  return host
}

/** Keep healthy native transports committed when the application expects one later start to fail. */
class IsolatedStartup {
  /** One genuine native owner retains every successful transport and the actual RPC domain. */
  readonly #host = isolatedNativeHost()
  /** Readiness joins both native installation transactions before calling the healthy children. */
  #opening: Promise<void> | undefined

  /** Start the application once; the rejected child installation is handled at its own boundary. */
  open(): Promise<void> {
    return (this.#opening ??= this.#open())
  }

  /** Publish this real Feature output through the parent transport's normal exposure authority. */
  readonly #ready = async (): Promise<boolean> => {
    await this.#opening
    await Promise.all([
      this.#namespace('pool').send(RPC_POOL_PEER_ID, Topology.ready),
      this.#namespace('coroutine').send(Topology.coroutine, Topology.ready)
    ])
    return true
  }

  /** Read a namespace published by the real SDK installation, never a synthetic RPC facade. */
  #namespace(name: string): IRpcNamespace {
    return Reflect.get(this.#host, name) as IRpcNamespace
  }

  /** Cold flow placement precedes native transport use; only c belongs to the failing transaction. */
  async #open(): Promise<void> {
    /** The same actual service Feature supplies the readiness method advertised to a. */
    const service = definePlugin({
      name: Topology.b,
      features: { readiness: defineFeature(() => ({ [Topology.ready]: this.#ready })) },
      install: () => ({})
    })
    /** Parent bootstrap keeps b's actual process identity and publishes the readiness Feature. */
    const parent = processPlugin({
      namespace: 'parent',
      connectToParent: true,
      expose: [Topology.b]
    })
    /** The original wrong-secret thread uses the same real generation and authentication owner. */
    const child = threadPlugin({
      name: Topology.c,
      spawn: { entry: threadEntry, data: options },
      features: threadFeatures
    })
    /** Healthy pool and coroutine retain their original source recipes and policy Features. */
    const members = threadPlugin({
      namespace: 'pool',
      spawn: { entry: threadEntry, data: {} },
      features: [pool({ size: 4 })]
    })
    /** The same coroutine task still owns its public leaf host and generation port. */
    const coroutine = coroutinePlugin({ name: Topology.coroutine, spawn: coroutineTask })
    await this.#host.use(
      service,
      recorder.plugin,
      rpcFlowPlugin([parent, child, members, coroutine])
    )
    await this.#host.use(parent, members, coroutine)
    try {
      await this.#host.use(child)
    } catch (error) {
      defaultRpcReporter(error)
    }
  }
}

if (options.hopAuth === 'mismatch') await new IsolatedStartup().open()
else {
  /** Opening Promise of b; providers await it before touching children. */
  const opening: Promise<IRpcHost> = createRpcHost({
    plugins: [
      recorder.plugin,
      processPlugin({ namespace: 'parent', connectToParent: true }),
      threadPlugin({
        name: Topology.c,
        spawn: { entry: threadEntry, data: options },
        features: threadFeatures
      }),
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
          ...(options.childProcess
            ? { d: await host.child.send(Topology.d, Topology.inspect) }
            : {}),
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
}
