import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeBorrowedPeer, nativeHostChildPath, nativeHostToken } from './fixtures/host-native.js'

/** The child and independent listener observer share the same fixture publication contract. */
const readyText = JSON.parse(
  readFileSync(
    new URL('../../../rpc-plugin-process/test/process/fixtures/host-ready.json', import.meta.url),
    'utf8'
  )
) as { committed: string }
/** A failed independent child must reject publication before clients attempt their first dial. */
const earlyExitText = 'Host listener fixture exited before publication'

/** Own the independent native child, bounded publication observer and exact OS cleanup. */
class IndependentHostPeer {
  /** The Unix socket is private to this independent child and its borrowed clients. */
  readonly address: string
  /** Retain the native child identity for ownership and liveness assertions. */
  readonly child
  /** Diagnostic chunks retain the original transcript without rescanning it for every chunk. */
  readonly errors: string[] = []
  /** The temporary socket directory is removed only after the native child exits. */
  readonly #directory: string
  /** Native exit/error settlement stays independent of listener readiness. */
  readonly #exited: Promise<void>
  /** Publication is observed from the same child marker rather than a wall-clock sleep. */
  readonly #ready: Promise<void>
  /** At most marker length minus one characters bridge split native stderr chunks. */
  #suffix = ''

  /** Spawn one native child and attach publication/error observers before its first event. */
  constructor(directory: string) {
    this.#directory = directory
    this.address = join(directory, 's')
    this.child = spawn(process.execPath, [nativeHostChildPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        RPC_HOST_ADDRESS: this.address,
        RPC_HOST_TOKEN: nativeHostToken,
        RPC_HOST_SECOND_TOKEN: 'host-second-fixture'
      }
    })
    this.#exited = new Promise<void>((resolve, reject) => {
      this.child.once('exit', () => resolve())
      this.child.once('error', reject)
    })
    this.#ready = new Promise<void>((resolve, reject) => {
      /** This short event listener mutates only its named fixture owner's transcript and suffix. */
      const onData = (chunk: Buffer): void => {
        /** A fixed marker suffix bounds readiness work to O(received bytes) across all chunks. */
        const next = this.#suffix + chunk.toString()
        this.errors.push(chunk.toString())
        if (next.includes(readyText.committed)) {
          this.child.stderr.off('data', onData)
          resolve()
        }
        this.#suffix = next.slice(-(readyText.committed.length - 1))
      }
      this.child.stderr.on('data', onData)
      this.child.stderr.on('data', (chunk: Buffer) => this.errors.push(chunk.toString()))
      this.child.once('error', reject)
      this.child.once('exit', () => reject(new Error(earlyExitText)))
    })
  }

  /** Create one independent listener and wait for its actual publication before returning it. */
  static async open(): Promise<IndependentHostPeer> {
    /** The original temporary directory belongs exclusively to this fixture. */
    const directory = await mkdtemp('/tmp/rpc-host-')
    /** Construct native observers synchronously before waiting for publication. */
    const peer = new IndependentHostPeer(directory)
    await peer.#ready
    return peer
  }

  /** Terminate only the fixture child, wait for exit, then remove its private socket directory. */
  async close(): Promise<void> {
    this.child.kill('SIGTERM')
    await this.#exited
    await rm(this.#directory, { recursive: true, force: true })
  }
}

describe('process Host real Unix service', () => {
  it('refuses connection 65 and request 33 at the default limits while another connection remains live', async () => {
    const peer = await IndependentHostPeer.open()
    const clients: Awaited<ReturnType<typeof nativeBorrowedPeer>>[] = []
    try {
      for (let index = 0; index < 64; index += 1) {
        const client = await nativeBorrowedPeer(peer.address)
        clients.push(client)
      }
      await expect(nativeBorrowedPeer(peer.address)).rejects.toBeDefined()
      const first = clients[0]!
      const second = clients[1]!
      const held = Array.from({ length: 32 }, () => first.peer.request('p.f.request', 'hold'))
      const outcomes = Promise.allSettled(held)
      await expect
        .poll(async () => (await second.peer.request('p.f.request', 'count')) as { calls: number })
        .toMatchObject({ calls: 32 })
      await expect(first.peer.request('p.f.request', 'rejected')).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(await second.peer.request('p.f.request', 'release-held')).toMatchObject({ calls: 33 })
      expect((await outcomes).every((row) => row.status === 'fulfilled')).toBe(true)
      expect(await second.peer.request('p.f.request', 'live')).toMatchObject({
        pid: peer.child.pid
      })
      expect(peer.errors.join('')).not.toContain(nativeHostToken)
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()))
      await peer.close()
    }
  })
  it('shares authenticated caches but releases only the borrowed connection', async () => {
    const peer = await IndependentHostPeer.open()
    const [first, second, other] = await Promise.all([
      nativeBorrowedPeer(peer.address),
      nativeBorrowedPeer(peer.address),
      nativeBorrowedPeer(peer.address, 'host-second-fixture')
    ])
    try {
      const key = randomUUID()
      const result = await first.peer.request('p.f.request', 'deduplicated', {
        idempotencyKey: key
      })
      expect(
        await second.peer.request('p.f.request', 'deduplicated', { idempotencyKey: key })
      ).toEqual(result)
      expect(result).toMatchObject({ pid: peer.child.pid, calls: 1 })
      expect(
        await other.peer.request('p.f.request', 'deduplicated', { idempotencyKey: key })
      ).toMatchObject({
        calls: 2
      })
      await expect(nativeBorrowedPeer(peer.address, 'wrong-fixture-token')).rejects.toBeDefined()
      await first.close()
      expect((await first.peer.describe()).connections).toEqual([
        expect.objectContaining({
          connection: expect.objectContaining({ status: 'departed' }),
          unit: expect.objectContaining({ state: 'disposed' })
        })
      ])
      expect(peer.child.exitCode).toBeNull()
      expect(process.kill(peer.child.pid!, 0)).toBe(true)
      expect(await second.peer.request('p.f.request', 'still-live')).toMatchObject({
        pid: peer.child.pid,
        calls: 3
      })
      expect(peer.errors.join('')).not.toContain(nativeHostToken)
      expect(peer.errors.join('')).not.toContain('host-second-fixture')
    } finally {
      await Promise.allSettled([first.close(), second.close(), other.close()])
      await peer.close()
    }
  })
})
