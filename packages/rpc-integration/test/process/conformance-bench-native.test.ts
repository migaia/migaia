import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The same Node-invoked bench helper owns the actual native Process resources. */
const sessionUrl = new URL('../bench/ipc-session.mjs', import.meta.url).href
/** This narrow structural type describes only the real public namespace and fixture lifecycle. */
type INativeBenchSession = {
  facade?: { request(method: string, payload?: unknown): Promise<unknown> }
  peerPid: number
  ready(): Promise<void>
  exchange(): Promise<void>
  close(): Promise<void>
}

/** These checks exercise concurrent business exchanges without collecting timing or ratio evidence. */
describe('current native benchmark sessions', () => {
  it.each(['stdio-framed', 'socket-framed'])(
    'preserves exact concurrent bare/RPC echoes over %s',
    async (carrier) => {
      /** Dynamic loading keeps Node-invoked JavaScript out of the TypeScript source graph. */
      const { createIpcSession } = await import(sessionUrl)
      /** Every side receives exactly the same JSON payload and physical carrier selection. */
      const payload = 'native protocol ' + 'x'.repeat(1024)
      for (const side of ['bare', 'rpc']) {
        /** Each side acquires and releases its own real child process. */
        const session: INativeBenchSession = await createIpcSession({ carrier, side, payload })
        /** Native lsof reports the actual listening Unix inode; no private plugin path is assumed. */
        const socketPaths =
          carrier === 'socket-framed' && side === 'rpc'
            ? execFileSync('/usr/sbin/lsof', ['-a', '-p', String(session.peerPid), '-U', '-Fn'], {
                encoding: 'utf8'
              })
                .split('\n')
                .flatMap((line) => {
                  const match = /^n(\/.*?)(?: type=|$)/u.exec(line)
                  return match ? [match[1]!] : []
                })
            : []
        try {
          await session.ready()
          expect(session.peerPid).toBeGreaterThan(0)
          expect(session.peerPid).not.toBe(process.pid)
          if (carrier === 'socket-framed' && side === 'rpc') {
            expect(socketPaths.length).toBeGreaterThan(0)
            /** Only this fixture's private directory and 0600 token file hold authentication bytes. */
            for (const path of socketPaths) {
              expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
              expect(statSync(join(dirname(path), 'token')).mode & 0o777).toBe(0o600)
            }
          }
          /** Two bounded batches prove correlation/FIFO accounting and reuse after settlement. */
          for (let batch = 0; batch < 2; batch++)
            await Promise.all(Array.from({ length: 16 }, () => session.exchange()))
          if (side === 'rpc') {
            expect(session.facade).toBeDefined()
            expect(await session.facade!.request('bench.echo', payload)).toBe(payload)
            expect(await session.facade!.request('bench.pid')).toBe(session.peerPid)
          }
        } finally {
          await session.close()
        }
        expect(() => process.kill(session.peerPid, 0)).toThrow()
        /** The parent owns a fresh socket directory, including listener inode and ownership data. */
        for (const path of socketPaths) {
          expect(existsSync(path)).toBe(false)
          expect(existsSync(dirname(path))).toBe(false)
        }
      }
    },
    30_000
  )
})
