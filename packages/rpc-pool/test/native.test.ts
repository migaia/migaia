import { expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createThreadPeer } from '@migaia/rpc-threads'
import { createProcessPeer } from '@migaia/rpc-process'
import type { IRuntimePeer } from '@migaia/rpc-core/remote'
import { defineProbe, RpcProbeKind, RpcProbeStage } from '@migaia/rpc-core/probe'
import { createThreadPool, createProcessPool } from '../src/index.js'

vi.mock('@migaia/rpc-threads', async (importOriginal) => {
  /** Spy on the actual public factory; every native launch and restart still uses its original code. */
  const actual = await importOriginal<typeof import('@migaia/rpc-threads')>()
  return { ...actual, createThreadPeer: vi.fn(actual.createThreadPeer) }
})
vi.mock('@migaia/rpc-process', async (importOriginal) => {
  /** Process business evidence also comes from its actual public factory rather than a fixture Peer. */
  const actual = await importOriginal<typeof import('@migaia/rpc-process')>()
  return { ...actual, createProcessPeer: vi.fn(actual.createProcessPeer) }
})

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
  /** The public factory spy observes only construction; it never substitutes restart behavior. */
  const threadFactory = vi.mocked(createThreadPeer)
  threadFactory.mockClear()
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
  const pool = await createThreadPool<IThreadApi>({ spawn, size: 1, probe: threadProbe })
  /** This is the actual same Core-owned Peer later retained by the pool. */
  const peer: IRuntimePeer = await threadFactory.mock.results[0]!.value
  /** Later readiness comes from real generation/endpoint rebind rather than a pool ready flag. */
  const ready = Promise.withResolvers<void>()
  /** The accepted public exit event is an independent observation of native failure. */
  const exits: Array<{ reason?: string; code?: unknown }> = []
  const stopReady = peer.on('ready', () => ready.resolve())
  const stopExit = peer.on('exit', (event) => {
    exits.push(event)
  })
  try {
    expect(threadFactory).toHaveBeenCalledTimes(1)
    expect(threadFactory.mock.calls[0]![0].spawn).toBe(spawn)
    expect(threadFactory.mock.calls[0]![0].probe).toBe(threadProbe)
    expect(threadFactory.mock.calls[0]![0]).toEqual({ spawn, probe: threadProbe })
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
    expect(threadFactory).toHaveBeenCalledTimes(1)
    await expect(readFile(journal, 'utf8')).resolves.toBe('crash\n')
  } finally {
    stopReady()
    stopExit()
    await pool.close()
    await rm(directory, { recursive: true, force: true })
  }

  /** The real Process short source uses its original stdio owner and serves a typed business call. */
  const processSpawn = new URL('./fixtures/process-child.mjs', import.meta.url)
  const processFactory = vi.mocked(createProcessPeer)
  processFactory.mockClear()
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
  const processes = await createProcessPool<IProcessApi>({
    spawn: processSpawn,
    size: 1,
    probe: processProbe
  })
  try {
    expect(await processes.request('math.double', 21)).toBe(42)
    expect(await processes.request('identity')).toBeGreaterThan(0)
    expect(processFactory).toHaveBeenCalledTimes(1)
    expect(processFactory.mock.calls[0]![0].probe).toBe(processProbe)
    expect(processFactory.mock.calls[0]![0]).toEqual({ spawn: processSpawn, probe: processProbe })
    expect(processLifecycle).toEqual(expect.arrayContaining(['handshake', 'ready']))
  } finally {
    await processes.close()
  }
}, 30_000)
