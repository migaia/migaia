import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fileLogStore } from '../src/file.ts'
import { LogRecordState } from '../src/index.ts'

/** The real public file entry preserves committed rows, state and its retained head on reopen. */
async function reopenFile(): Promise<void> {
  /** The test owns this temporary native database and removes it after closing both owners. */
  const directory = await mkdtemp(join(tmpdir(), 'durable-file-entry-'))
  /** Both connections open this exact original SQLite file in sequence. */
  const path = join(directory, 'records.sqlite')
  try {
    /** First resource commits one original record before returning its native lock. */
    const first = await fileLogStore(path)
    await first.append([{ kind: 'saved', payload: { id: 1 } }])
    await first.setState(1, LogRecordState.done)
    await first.dispose()
    /** Reopening uses the same storage format and continues its committed sequence. */
    const reopened = await fileLogStore(path)
    try {
      expect(await reopened.read(1, 2)).toMatchObject([
        { seq: 1, kind: 'saved', payload: { id: 1 } }
      ])
      expect(await reopened.states(LogRecordState.pending)).toEqual([])
      expect(await reopened.append([{ kind: 'next', payload: null }])).toEqual([2])
    } finally {
      await reopened.dispose()
    }
    /** Browser condition import is safe and opening rejects with the declared unavailable code. */
    const browser = execFileSync(
      process.execPath,
      [
        '--conditions=browser',
        '--input-type=module',
        '--eval',
        "import { strict as assert } from 'node:assert'; const entry = await import('@migaia/log-plugin-durable/file'); await assert.rejects(entry.fileLogStore('unused'), { source: 'logging.durable', code: 'LOG_STORE_UNAVAILABLE' })"
      ],
      { cwd: new URL('../', import.meta.url), encoding: 'utf8' }
    )
    expect(browser).toBe('')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it('reopens the original committed file and exposes a browser-safe public condition', reopenFile)
