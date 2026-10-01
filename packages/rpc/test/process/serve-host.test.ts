import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeBorrowedHost, nativeHostChildPath, nativeHostToken } from './fixtures/host-native.js'

/** Start a genuinely independent peer and wait for the listener publication, not a fixed delay. */
async function independentHostPeer(resolverMode = '') {
  const directory = await mkdtemp('/tmp/rpc-host-')
  const address = join(directory, 's')
  const errors: string[] = []
  const child = spawn(process.execPath, [nativeHostChildPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      RPC_HOST_ADDRESS: address,
      RPC_RESOLVER_MODE: resolverMode,
      RPC_HOST_TOKEN: nativeHostToken,
      RPC_HOST_SECOND_TOKEN: 'host-second-fixture'
    }
  })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve())
    child.once('error', reject)
  })
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      errors.push(chunk.toString())
      if (errors.join('').includes('host-listener-ready')) {
        child.stderr.off('data', onData)
        resolve()
      }
    }
    child.stderr.on('data', onData)
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString()))
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Host listener fixture exited before publication')))
  })
  return {
    address,
    child,
    errors,
    async close() {
      child.kill('SIGTERM')
      await exited
      await rm(directory, { recursive: true, force: true })
    }
  }
}

describe('process Host real Unix service', () => {
  it.each(['wrong-name', 'promise', 'invalid', 'throw'])(
    '[A5] keeps invalid local resolver output off the real Host while other control stays live (%s)',
    async (mode) => {
      const peer = await independentHostPeer(mode)
      const client = nativeBorrowedHost(peer.address)
      try {
        await client.ready()
        const error = await client.use('p').then(
          () => undefined,
          (failure: unknown) => failure
        )
        if (mode === 'throw')
          expect(error).toMatchObject({
            code: 'PROCESS_HOST_INVALID_OPTION',
            cause: { code: 'PROCESS_CHANNEL_CLOSED', stack: expect.any(String) }
          })
        else expect(error).toMatchObject({ code: 'REMOTE_CONTRACT_INVALID' })
        expect(await client.inspect()).toMatchObject({ plugins: [] })
        await expect(client.use('undeclared')).rejects.toMatchObject({
          code: 'REMOTE_CONTRACT_INVALID'
        })
      } finally {
        await client.release()
        await peer.close()
      }
    }
  )
  it('[A6] refuses connection 65 and request 33 at the default limits while another connection remains live', async () => {
    const peer = await independentHostPeer()
    const clients: ReturnType<typeof nativeBorrowedHost>[] = []
    try {
      for (let index = 0; index < 64; index += 1) {
        const client = nativeBorrowedHost(peer.address)
        clients.push(client)
        await client.ready()
      }
      const refused = nativeBorrowedHost(peer.address)
      clients.push(refused)
      await expect(refused.ready()).rejects.toBeDefined()
      const first = await clients[0]!.use('p')
      const second = await clients[1]!.use('p')
      const held = Array.from({ length: 32 }, () => first.f!.request!(['hold']))
      const outcomes = Promise.allSettled(held)
      await expect
        .poll(async () => (await second.f!.request!(['count'])) as { calls: number })
        .toMatchObject({ calls: 32 })
      await expect(first.f!.request!(['rejected'])).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(await second.f!.request!(['release-held'])).toMatchObject({ calls: 33 })
      expect((await outcomes).every((row) => row.status === 'fulfilled')).toBe(true)
      expect(await second.f!.request!(['live'])).toMatchObject({ pid: peer.child.pid })
      expect(peer.errors.join('')).not.toContain(nativeHostToken)
    } finally {
      await Promise.allSettled(clients.map((client) => client.release()))
      await peer.close()
    }
  })
  it('[A2/A5/A6] shares authenticated caches but releases only the borrowed connection', async () => {
    const peer = await independentHostPeer()
    const first = nativeBorrowedHost(peer.address)
    const second = nativeBorrowedHost(peer.address)
    const other = nativeBorrowedHost(peer.address, 'host-second-fixture')
    const refused = nativeBorrowedHost(peer.address, 'wrong-fixture-token')
    try {
      await Promise.all([first.ready(), second.ready(), other.ready()])
      const one = await first.use('p')
      const two = await second.use('p')
      const different = await other.use('p')
      const key = randomUUID()
      const result = await one.f!.request!(['deduplicated'], { idempotencyKey: key })
      expect(await two.f!.request!(['deduplicated'], { idempotencyKey: key })).toEqual(result)
      expect(result).toMatchObject({ pid: peer.child.pid, calls: 1 })
      expect(await different.f!.request!(['deduplicated'], { idempotencyKey: key })).toMatchObject({
        calls: 2
      })
      await expect(refused.ready()).rejects.toBeDefined()
      await first.release()
      expect(first.inspectRegistration()).toBeUndefined()
      expect(peer.child.exitCode).toBeNull()
      expect(process.kill(peer.child.pid!, 0)).toBe(true)
      expect(await two.f!.request!(['still-live'])).toMatchObject({ pid: peer.child.pid, calls: 3 })
      expect(peer.errors.join('')).not.toContain(nativeHostToken)
      expect(peer.errors.join('')).not.toContain('host-second-fixture')
    } finally {
      await Promise.allSettled([
        first.release(),
        second.release(),
        other.release(),
        refused.release()
      ])
      await peer.close()
    }
  })
})
