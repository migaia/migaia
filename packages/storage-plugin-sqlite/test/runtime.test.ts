import { execFileSync, fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { ConcurrencyPolicy, lockKey } from '@migaia/storage-host/sdk'
import { sleep } from '@migaia/utils/promise'
import { sqliteBackendPlugin } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'
/** The same plain-JavaScript consumer proves the actual built entries in separate runtime processes. */
const fixture = fileURLToPath(new URL('./runtime-matrix.mjs', import.meta.url))
it.each(['Node', 'Bun', 'Deno'] as const)(
  'persists, reopens and composes entities with exact integers through %s',
  (runtime) => {
    const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-runtime-'))
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
    const path = join(directory, 'runtime.sqlite')
    const binary = runtime === 'Node' ? process.execPath : runtime === 'Bun' ? 'bun' : 'deno'
    const prefix = runtime === 'Deno' ? ['run', '-A', '--node-modules-dir=manual'] : []
    for (const phase of ['write', 'read']) {
      const stdout = execFileSync(binary, [...prefix, fixture, phase, path], {
        encoding: 'utf8',
        timeout: 15000
      })
      expect(JSON.parse(stdout.trim())).toMatchObject({
        runtime,
        phase,
        count: 1,
        entity: 'versioned-query',
        result: 'passed'
      })
    }
  },
  30000
)
/**
 * A killed writer leaves a visible lease until expiry; SQLite itself rolls back its uncommitted
 * data.
 */
it('recovers native data and reclaims expired logical rows after a writer process dies', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-crash-'))
  const path = join(directory, 'crash.sqlite')
  const connection = nodeSqliteDriver(path)
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection })] as const
  })
  const store = host.backend('sqlite')
  await store.set('crash', 'before')
  const child = fork(fixture, ['hold', path], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  await once(child, 'message')
  const holdings = await store.inspectLocks()
  expect(holdings).toHaveLength(1)
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  expect(await store.get('crash')).toBe('before')
  await expect(
    store
      .tx()
      .lock(lockKey.text('crash'))
      .concurrency(ConcurrencyPolicy.fail())
      .run(() => undefined)
  ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
  await sleep(Math.max(0, holdings[0]!.expiresAt! - Date.now() + 20))
  expect((await store.inspectLocks())[0]?.expired).toBe(true)
  await store
    .tx()
    .lock(lockKey.text('crash'))
    .run((tx) => tx.set('crash', 'after'))
  expect(await store.get('crash')).toBe('after')
  expect(await store.inspectLocks()).toEqual([])
}, 15000)
