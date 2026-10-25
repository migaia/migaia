import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

/** Package entries remain distinct so browser-safe imports never eagerly load SQLite. */
describe('durable package entries', () => {
  it('publishes only durable factories and portable contracts from the portable entry', async () => {
    const entry = await import('../dist/plugins/durable/index.js')
    expect(Object.keys(entry).sort()).toEqual([
      'LogRecordState',
      'LogStage',
      'assertLogInteger',
      'binlog',
      'createLogStoreIndex',
      'memoryLogStore',
      'prepareLogAppend',
      'snapshotLogRecords',
      'snapshotLogStoreState',
      'undoLog',
      'wal'
    ])
    expect(Object.keys(await import('../dist/plugins/durable/file.js'))).toEqual(['fileLogStore'])
    const { Logger } = await import('../dist/index.js')
    const { level } = await import('../dist/plugins/index.js')
    const categorized = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [level()]
    })
    expect(typeof categorized.atLevel).toBe('function')
    await categorized.shutdown('manual')
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.exports['./plugins/durable/file'].browser).toBe(
      './dist/plugins/durable/file.browser.js'
    )
    expect(manifest.dependencies).not.toHaveProperty('@migaia/storage-contract')
    expect(manifest.dependencies).not.toHaveProperty('fs-ext')
    expect(manifest.peerDependencies).toBeUndefined()
  })
  it('loads the browser file entry safely and rejects unsupported opening explicitly', async () => {
    const { fileLogStore } = await import('../dist/plugins/durable/file.browser.js')
    await expect(fileLogStore('local.sqlite')).rejects.toMatchObject({
      source: '@migaia/logger',
      code: 'LOG_STORE_UNAVAILABLE'
    })
  })
})
