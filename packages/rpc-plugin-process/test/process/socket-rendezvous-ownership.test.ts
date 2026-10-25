import { describe, expect, it } from 'vitest'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'

/** Raw endpoint ownership stays independent from retired adapter-level authentication options. */
describe('Node rendezvous socket ownership', () => {
  it.skipIf(process.platform === 'win32')(
    'reclaims only the same service and inode after a crashed listener',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'owner-'))
      const path = join(directory, 's')
      /** The child exits without Node's normal unlink so the owner record is truly stale. */
      const code = `const fs=require('node:fs');const net=require('node:net');const path=process.argv[1];net.createServer().listen(path,()=>{const s=fs.lstatSync(path);fs.writeFileSync(path+'.owner.json',JSON.stringify({serviceId:'service-a',path,dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid}),{mode:0o600});process.stdout.write('ready')})`
      const child = spawn(process.execPath, ['-e', code, path], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      try {
        await new Promise<void>((resolve, reject) => {
          child.stdout!.once('data', () => resolve())
          child.once('error', reject)
          child.once('exit', (status) => {
            if (status !== null && status !== 0) reject(new Error('Stale listener fixture exited'))
          })
        })
        const exited = once(child, 'close')
        child.kill('SIGKILL')
        await exited
        const original = await lstat(path)
        await expect(
          listenProcessByteChannel({
            address: path,
            serviceId: 'service-b',
            onConnection: () => undefined,
            report: () => undefined
          })
        ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
        expect((await lstat(path)).ino).toBe(original.ino)
        /** Matching service alone cannot authorize deletion of a replaced inode. */
        const ownerText = await readFile(`${path}.owner.json`, 'utf8')
        const changedOwner = JSON.parse(ownerText) as Record<string, unknown>
        changedOwner.ino = original.ino + 1
        await writeFile(`${path}.owner.json`, JSON.stringify(changedOwner))
        await expect(
          listenProcessByteChannel({
            address: path,
            serviceId: 'service-a',
            onConnection: () => undefined,
            report: () => undefined
          })
        ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
        expect((await lstat(path)).ino).toBe(original.ino)
        await writeFile(`${path}.owner.json`, ownerText)
        const recovered = await listenProcessByteChannel({
          address: path,
          serviceId: 'service-a',
          onConnection: (pending) => pending.close(),
          report: () => undefined
        })
        expect((await lstat(path)).isSocket()).toBe(true)
        await recovered.close()
        await expect(lstat(`${path}.owner.json`)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        child.kill('SIGKILL')
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it('records a private Unix socket owner and refuses a foreign path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'owner-'))
    const path = join(directory, 's')
    try {
      const listener = await listenProcessByteChannel({
        address: path,
        serviceId: 'service-a',
        onConnection: (pending) => pending.close(),
        report: () => undefined
      })
      const ownStat = await lstat(path)
      const record = JSON.parse(await readFile(`${path}.owner.json`, 'utf8')) as {
        serviceId: string
        ino: number
      }
      expect(record).toMatchObject({ serviceId: 'service-a', ino: ownStat.ino })
      await expect(
        listenProcessByteChannel({
          address: path,
          serviceId: 'service-b',
          onConnection: () => undefined,
          report: () => undefined
        })
      ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
      expect((await lstat(path)).ino).toBe(ownStat.ino)
      await listener.close()
      await expect(lstat(`${path}.owner.json`)).rejects.toMatchObject({ code: 'ENOENT' })
      /** An unrelated regular file is never inferred to be this service's stale socket. */
      await writeFile(path, 'other-service-data')
      await expect(
        listenProcessByteChannel({
          address: path,
          serviceId: 'service-a',
          onConnection: () => undefined,
          report: () => undefined
        })
      ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
      expect(await readFile(path, 'utf8')).toBe('other-service-data')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('binds a Unix socket, removes only its own path, and preserves an occupied path', async () => {
    const folder = fileURLToPath(new URL('./', import.meta.url))
    /** A short temporary name stays below Darwin's Unix-domain path limit. */
    const path = join(tmpdir(), `r-${randomUUID().slice(0, 8)}.sock`)
    const listener = await listenProcessByteChannel({
      address: path,
      onConnection: (pending) => pending.close(),
      report: () => undefined
    })
    try {
      expect(listener.address).toBe(path)
      expect((await lstat(path)).isSocket()).toBe(true)
      const dialed = await dialProcessByteChannel({ address: path })
      await dialed.close()
    } finally {
      await listener.close()
    }
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    const occupied = resolve(folder, 'connect-existing.test.ts')
    await expect(
      listenProcessByteChannel({
        address: occupied,
        onConnection: () => undefined,
        report: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
    expect((await lstat(occupied)).isFile()).toBe(true)
  })
})
