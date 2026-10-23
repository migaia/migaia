import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { createRpcHost } from '@migaia/rpc-host'
import type { IRuntimePeer, IRpcHostMember } from '@migaia/rpc-host/plugin'
import { readRpcPluginMetadata } from '../../rpc-host/dist/plugin/metadata.js'
import { readAdapterDeployment } from '../../rpc-host/dist/runtime-adapter/deployment.js'
import { poolPlugin, observingPool } from './pool-fixture.js'
import { defineProbe, RpcProbeKind, RpcProbeStage } from '@migaia/rpc-host/probe'
/** Native Worker identity independently proves that the existing supervisor launched another unit. */
type IThreadApi = {
  echo(value: number): number
  identity(): number
  crash(input: { journal: string }): never
}
/** The second real source demonstrates the Process public factory/stdio business path. */
type IProcessApi = { math: { double(value: number): number }; identity(): number }

it('preserves failed work once while the same real Peer restarts and serves future calls', async () => {
  /** Native fixture data stays inside this owning package's test directory. */
  const directory = await mkdtemp(join(import.meta.dirname, 'native-journal-'))
  /** Every line is written by the actual crashing business method before its native exit. */
  const journal = join(directory, 'executions.txt')
  /** An exact entry URL uses the short source through the existing Thread launcher. */
  const spawn = new URL('./fixtures/thread-child.mjs', import.meta.url)
  /** The existing SDK callback observes actual managed receipts, without replacing native opening. */
  const threadMembers: IRpcHostMember[] = []
  /** Retain scalar lifecycle observations from the actual pooled Thread Peer synchronously. */
  const threadLifecycle: string[] = []
  /** The pool forwards this original peer-only handle without wrapping the native factory. */
  const threadProbe = defineProbe({
    stages: ['peer'],
    /** Read the reused view during emit; no observation object escapes this callback. */
    emit(view) {
      expect(view.stage).toBe(RpcProbeStage.peer)
      expect(view.kind).toBe(RpcProbeKind.lifecycle)
      threadLifecycle.push(view.lifecycle!)
    }
  })
  /** One actual Thread member retains the original pool business and supervision path. */
  const threadTransport = threadPlugin({ spawn, probe: threadProbe })
  const pool = await createRpcHost<IThreadApi>({
    plugins: [threadTransport, observingPool(poolPlugin({ size: 1 }), threadMembers)]
  })
  /** This is the actual same Core-owned Peer later retained by the pool. */
  const peer = threadMembers[0]! as unknown as IRuntimePeer
  /** Later readiness comes from real generation/endpoint rebind rather than a pool ready flag. */
  const ready = Promise.withResolvers<void>()
  /** The accepted public exit event is an independent observation of native failure. */
  const exits: Array<{ reason?: string; code?: unknown }> = []
  const stopReady = peer.on('ready', () => ready.resolve())
  const stopExit = peer.on('exit', (event) => {
    exits.push(event)
  })
  try {
    expect(threadMembers).toHaveLength(1)
    const threadDefinition = readRpcPluginMetadata(threadTransport)!
    expect(threadDefinition.kind).toBe('transport')
    if (threadDefinition.kind !== 'transport') return
    expect(
      readAdapterDeployment(threadDefinition.definition.deployment)!.runtimeOptions!.probe
    ).toBe(threadProbe)
    expect(threadDefinition.definition.mode).toBe('spawn')
    expect(threadLifecycle).toEqual(expect.arrayContaining(['handshake', 'ready']))
    const previous = await pool.request('identity')
    /** This failed business call remains failed; the pool does not replay it in the new unit. */
    const failure = await pool.request('crash', { journal }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toMatchObject({ source: 'rpc.pool' })
    await ready.promise
    expect(exits).toContainEqual(expect.objectContaining({ reason: 'crashed', code: 1 }))
    expect(await pool.request('echo', 42)).toBe(42)
    expect(await pool.request('identity')).not.toBe(previous)
    expect(threadMembers).toHaveLength(1)
    await expect(readFile(journal, 'utf8')).resolves.toBe('crash\n')
  } finally {
    stopReady()
    stopExit()
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }

  /** The real Process short source uses its original stdio owner and serves a typed business call. */
  const processSpawn = new URL('./fixtures/process-child.mjs', import.meta.url)
  const processMembers: IRpcHostMember[] = []
  /** Retain scalar lifecycle observations from the actual pooled Process Peer synchronously. */
  const processLifecycle: string[] = []
  /** The Process pool must forward this original peer-only handle through its public factory. */
  const processProbe = defineProbe({
    stages: ['peer'],
    /** Read lifecycle metadata synchronously rather than retaining the reusable event view. */
    emit(view) {
      expect(view.stage).toBe(RpcProbeStage.peer)
      expect(view.kind).toBe(RpcProbeKind.lifecycle)
      processLifecycle.push(view.lifecycle!)
    }
  })
  /** One actual Process member exercises probe forwarding alongside its existing typed calls. */
  const processTransport = processPlugin({ spawn: processSpawn, probe: processProbe })
  const processes = await createRpcHost<IProcessApi>({
    plugins: [processTransport, observingPool(poolPlugin({ size: 1 }), processMembers)]
  })
  try {
    expect(await processes.request('math.double', 21)).toBe(42)
    expect(await processes.request('identity')).toBeGreaterThan(0)
    expect(processMembers).toHaveLength(1)
    const processDefinition = readRpcPluginMetadata(processTransport)!
    expect(processDefinition.kind).toBe('transport')
    if (processDefinition.kind !== 'transport') return
    expect(
      readAdapterDeployment(processDefinition.definition.deployment)!.runtimeOptions!.probe
    ).toBe(processProbe)
    expect(processDefinition.definition.mode).toBe('spawn')
    expect(processLifecycle).toEqual(expect.arrayContaining(['handshake', 'ready']))
  } finally {
    await processes.close()
  }
}, 30_000)
