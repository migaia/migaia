import { snapshot } from './observe.mjs'
import { fileURLToPath } from 'node:url'
import { IpcBenchErrorText } from './error-text.mjs'
import { RuntimeBench } from './text.mjs'

/** Existing Worker entry installs its actual automatic factory using the original library bootstrap. */
const entry = fileURLToPath(new URL('./ipc-session.mjs', import.meta.url))

/**
 * Build one original owned Node source, retaining native handles for independent cold sampling.
 *
 * @param {string} topology Actual worker role in this fixed benchmark graph.
 * @param {object} policy Original classification/provider policy supplied by the session owner.
 * @param {object[]} handles Actual launcher results, never facade-shaped process observations.
 * @returns {Promise<object>} Original thread source specification.
 */
async function source(topology, policy, handles) {
  const { createNodeThreadLauncher, createNodeThreadChannelFactory } =
    await import('@migaia/rpc/threads/adapters/node')
  const { createUnitBudget } = await import('@migaia/supervision')
  const { systemScheduler } = await import('@migaia/utils/scheduler')
  /**
   * Wrapping only records the exact native handle and preserves its original private launch
   * context.
   */
  const launcher = createNodeThreadLauncher()
  return {
    spec: { entry, name: topology, data: { topology } },
    launcher: {
      ...launcher,
      async launch(spec, context) {
        const handle = await launcher.launch(spec, context)
        handles.push(handle)
        return handle
      }
    },
    budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    scheduler: systemScheduler,
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
    report: policy.report
  }
}

/**
 * Execute ordinary requests through the committed Host outlet or its actual one-hop forward table.
 *
 * @param {{ carrier: string; side: string; payload: string; topology: string }} options Fixed
 *   graph.
 * @param {object} policy Original provider limits, full rejection classifier and report owner.
 * @returns {Promise<object>} Owned session with genuine Peer/Host provenance and native
 *   observations.
 * @throws {Error} Original construction, request, resource or cleanup failure.
 */
export async function createRuntimeSession({ carrier, side, payload, topology }, policy) {
  if (
    side !== 'rpc' ||
    ![RuntimeBench.managed, RuntimeBench.oneHop, RuntimeBench.reverse].includes(topology) ||
    carrier !== (topology === RuntimeBench.oneHop ? RuntimeBench.mixedCarrier : 'worker')
  )
    throw new TypeError(IpcBenchErrorText.configuration)
  const { PluginHost } = await import('@migaia/plugin-host')
  const { createThreadPeer, createThreadPlugin } = await import('@migaia/rpc/threads')
  const { createProcessPlugin, createProcessTransport } = await import('@migaia/rpc/process')
  const { readRuntimeOutletConnection } = await import('../dist/remote/runtime-api/outlet.js')
  /** Captured handles are the canonical launcher's actual native resource observations. */
  const handles = []
  if (topology === RuntimeBench.reverse) {
    /** The ordinary parent provider is real business; only the child owns the timing loop. */
    const peer = await createThreadPeer({
      self: { name: 'parent', instanceId: 'parent' },
      providerLimits: policy.providerLimits,
      report: policy.report,
      provide: { bench: { echo: (value) => value, snapshot } },
      spawn: await source(RuntimeBench.reverse, policy, handles)
    })
    /**
     * This diagnostic identity is supplied by a real child call, independently matched to its
     * handle.
     */
    let initiatorThreadId
    return {
      facade: peer,
      peerPid: process.pid,
      ready: async () => undefined,
      get initiatorThreadId() {
        return initiatorThreadId
      },
      exchange: async () => {
        const result = await peer.request(RuntimeBench.reverseProbe, payload)
        if (result.value !== payload || result.initiatorThreadId !== handles[0].identity.threadId)
          throw new Error(IpcBenchErrorText.echo)
        initiatorThreadId = result.initiatorThreadId
      },
      runInInitiator: (unit, options) => peer.request(RuntimeBench.measure, { unit, options }),
      peerSnapshot: () => peer.request(RuntimeBench.snapshot),
      classification: () => policy.classification,
      close: () => peer.close()
    }
  }
  /** Only this real Host owns the managed connection definition and its committed shared slot. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  try {
    if (topology === 'managed')
      await host.use(
        createThreadPlugin({
          name: 'bench',
          self: { name: 'parent', instanceId: 'parent' },
          providerLimits: policy.providerLimits,
          report: policy.report,
          spawn: await source('leaf', policy, handles)
        })
      )
    else {
      const { createNodeProcessLauncher } =
        await import('@migaia/rpc/process/adapters/node-child-process')
      const { systemScheduler } = await import('@migaia/utils/scheduler')
      const { createUnitBudget } = await import('@migaia/supervision')
      /** The process relay can explicitly own a Worker without ambiguous automatic Thread sources. */
      const launcher = createNodeProcessLauncher()
      await host.use(
        createProcessPlugin({
          name: 'bench',
          self: { name: 'parent', instanceId: 'parent' },
          providerLimits: policy.providerLimits,
          report: policy.report,
          spawn: {
            kind: 'spawn',
            channelKind: 'byte',
            wire: 'native',
            token: RuntimeBench.token,
            supervision: {
              id: 'relay',
              scheduler: systemScheduler,
              isolation: 'best-effort',
              report: policy.report,
              budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
              output: {
                onChunk: (stream, chunk) => {
                  if (stream === 'stderr')
                    process.stderr.write(
                      Buffer.from(chunk)
                        .toString()
                        .replaceAll(RuntimeBench.token, '[REDACTED_AUTH]')
                    )
                }
              },
              spec: {
                command: process.execPath,
                args: [entry, '--runtime-child'],
                env: {
                  inherit: ['PATH'],
                  set: { IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.relay' }
                },
                stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
                bootstrap: {
                  via: 'stdin',
                  payload: new TextEncoder().encode(RuntimeBench.token)
                }
              },
              launcher: {
                ...launcher,
                async launch(spec, context) {
                  const handle = await launcher.launch(spec, context)
                  handles.push(handle)
                  return handle
                }
              }
            },
            rawChannel: (handle) => handle.channel,
            establish: (raw, context) =>
              createProcessTransport(raw, {
                role: 'initiator',
                peerId: handles.at(-1).runtimeApiIdentity.instanceId,
                offer: context.offer,
                signal: context.signal,
                scheduler: context.scheduler,
                ipc: { ...context.session, log: () => undefined },
                report: policy.report
              })
          }
        })
      )
    }
    /** Family selection is the actual carrier owner, never a copied facade with shared methods. */
    const outlet = topology === 'managed' ? host.thread : host.process
    /** The accepted private receipt is read from the original committed slot, not a copied registry. */
    const facade = readRuntimeOutletConnection(outlet, 'bench').peer
    if (topology === RuntimeBench.oneHop) await outlet.request('bench', RuntimeBench.ready)
    /** Forward selection goes through the real exposed connection path, preserving its provider. */
    const method = topology === RuntimeBench.managed ? 'bench.echo' : RuntimeBench.forwardedEcho
    return {
      host,
      facade,
      peerPid: topology === 'managed' ? process.pid : handles[0].identity.pid,
      nativeHandles: handles,
      ready: async () => undefined,
      exchange: async () => {
        if ((await outlet.request('bench', method, payload)) !== payload)
          throw new Error(IpcBenchErrorText.echo)
      },
      peerSnapshot: () => outlet.request('bench', RuntimeBench.snapshot),
      classification: () => policy.classification,
      close: async () => {
        /** Preserve an original leaf withdrawal failure if outer Host cleanup also fails. */
        const failures = []
        try {
          // Release the relay's actual child through its original Host before terminating the relay.
          if (topology === RuntimeBench.oneHop)
            await outlet.request('bench', RuntimeBench.releaseLeaf)
        } catch (error) {
          failures.push(error)
        }
        try {
          await host.dispose()
        } catch (error) {
          failures.push(error)
        }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, IpcBenchErrorText.cleanup)
      }
    }
  } catch (primary) {
    try {
      await host.dispose()
    } catch (cleanup) {
      policy.report(cleanup)
    }
    throw primary
  }
}

/**
 * Install either the genuine leaf Peer or relay Host over this launcher's automatic parent channel.
 *
 * @param {{ topology: string }} input Portable role data from the actual launcher spec.
 * @param {object} policy Existing provider/rejection/report owner, with no fixture codec or queue.
 * @returns {Promise<void>} Actual role readiness; all physical dispatch remains in RPC.
 */
export async function serveRuntimeWorker(input, policy) {
  const { createThreadPeer, createThreadPlugin } = await import('@migaia/rpc/threads')
  const { createProcessPlugin } = await import('@migaia/rpc/process')
  if (input.topology === RuntimeBench.reverse) {
    /** Handler closures capture only this exact factory Promise; no callback reselects a successor. */
    const prepared = createThreadPeer({
      providerLimits: policy.providerLimits,
      report: policy.report,
      provide: {
        bench: {
          snapshot,
          reverseProbe: async (value) => {
            const peer = await prepared
            return {
              value: await peer.request(RuntimeBench.echo, value),
              initiatorThreadId: snapshot().threadId
            }
          },
          measure: async ({ unit, options }) => {
            const { measureBare } = await import('./ipc.mjs')
            const { createMacPidObserver } = await import('./bare-node.mjs')
            const peer = await prepared
            const observer = await createMacPidObserver([process.pid])
            const payload = 'x'.repeat(unit.payloadBytes)
            try {
              for (let index = 0; index < (options.warmup ?? 100); index++)
                await peer.request(RuntimeBench.echo, payload)
              const parentBefore = await peer.request(RuntimeBench.snapshot)
              const peerBefore = snapshot()
              const measured = await measureBare({
                observer,
                samples: options.samples ?? 1000,
                concurrency: unit.concurrency,
                warmup: 0,
                ready: async () => undefined,
                exchange: async () => {
                  if ((await peer.request(RuntimeBench.echo, payload)) !== payload)
                    throw new Error(IpcBenchErrorText.echo)
                }
              })
              return {
                ...measured,
                type: 'ipc-side',
                unit,
                side: 'rpc',
                parentBefore,
                peerBefore,
                parentAfter: await peer.request(RuntimeBench.snapshot),
                peerAfter: snapshot(),
                initiatorRole: 'worker',
                initiatorThreadId: peerBefore.threadId,
                timingClock:
                  'native Worker process.hrtime.bigint; parent trigger outside measured loop',
                classification: policy.classification,
                samplingMaxReplayEntriesPerPeer: 1200,
                providerConcurrency: 'NOT_INSTRUMENTED_FORMAL',
                gcStatus: 'NOT_COLLECTED_FORMAL_TIMING'
              }
            } finally {
              await observer.close()
            }
          }
        }
      }
    })
    await prepared
    return
  }
  if (input.topology === 'leaf') {
    await createThreadPeer({
      providerLimits: policy.providerLimits,
      report: policy.report,
      provide: { bench: { echo: (payload) => payload, snapshot } }
    })
    return
  }
  const { PluginHost } = await import('@migaia/plugin-host')
  /** The relay has a real Host and two distinct canonical registrations, never a fixture router. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Leaf native resources remain owned by the original committed definition. */
  const handles = []
  await host.use(
    createThreadPlugin({
      name: 'leaf',
      report: policy.report,
      providerLimits: policy.providerLimits,
      spawn: await source('leaf', policy, handles)
    })
  )
  /** Awaiting this exact transaction distinguishes directory readiness from actual Host commit. */
  let installed
  installed = host.use(
    createProcessPlugin({
      name: 'parent',
      expose: ['leaf'],
      report: policy.report,
      providerLimits: policy.providerLimits,
      provide: {
        bench: {
          ready: async () => {
            await installed
            return true
          },
          snapshot: async () => ({
            ...snapshot(),
            descendant: await host.thread.request('leaf', 'bench.snapshot')
          }),
          releaseLeaf: async () => {
            await host.unUse('leaf')
            return true
          }
        }
      }
    })
  )
  await installed
}
