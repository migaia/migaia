import { afterEach, describe, expect, it } from 'vitest'
import { Logger } from '../../src/log.js'
import { file as browserFile } from '../../src/plugins/file.browser.js'
import { file } from '../../src/plugins/file.js'
import { getLoggerRuntimeManager, setLoggerRuntimeManager } from '../../src/runtime-manager.js'
import { LoggerErrorCode } from '../../src/error-code.js'

/** Restores each injected capability without changing another test's runtime manager. */
const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
})

describe('file sink batches writes and flushes before disposal', () => {
  it('batches entries into one injected append and rotates after the threshold', async () => {
    /** Exact append calls prove the batcher, not a parallel file buffer, owns delivery. */
    const writes: Array<{ path: string; text: string }> = []
    /** Rotation calls remain on the injected optional capability. */
    const rotations: string[] = []
    restores.push(
      setLoggerRuntimeManager({
        ...getLoggerRuntimeManager(),
        fs: {
          append: async (path, text) => {
            writes.push({ path, text })
          },
          rotate: async (path) => {
            rotations.push(path)
          }
        }
      })
    )
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [file({ path: 'logs/app.jsonl', batch: { maxSize: 10 }, rotate: { maxEntries: 2 } })]
    })
    logger.log('info', 'first')
    logger.log('info', 'second')
    await logger.flush()
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('logs/app.jsonl')
    expect(writes[0]?.text.trim().split('\n')).toHaveLength(2)
    expect(writes[0]?.text).toContain('first')
    expect(writes[0]?.text).toContain('second')
    expect(rotations).toEqual(['logs/app.jsonl'])
    await (logger as unknown as { dispose(): Promise<unknown> }).dispose()
  })

  it('rejects browser installation without an injected file capability', () => {
    restores.push(setLoggerRuntimeManager({ ...getLoggerRuntimeManager(), fs: undefined }))
    expect(
      () =>
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [browserFile({ path: 'logs/app.jsonl' })]
        })
    ).toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({ code: LoggerErrorCode.fileSinkUnavailable })
      })
    )
  })

  it('reports append failures without throwing through log dispatch', async () => {
    /** Exact append failure must remain reachable from the reported delivery error. */
    const appendFailure = new Error('append denied')
    /** Logger's existing failure channel owns failed sink delivery. */
    const failures: unknown[] = []
    restores.push(
      setLoggerRuntimeManager({
        ...getLoggerRuntimeManager(),
        fs: { append: async () => Promise.reject(appendFailure) }
      })
    )
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [browserFile({ path: 'logs/app.jsonl', batch: { maxSize: 1 } })]
    })
    logger.onFailure(({ error }) => failures.push(error))
    expect(() => logger.log('info', 'failed-write')).not.toThrow()
    await logger.flush()
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: LoggerErrorCode.deliveryFailed, cause: appendFailure })
      ])
    )
    await (logger as unknown as { dispose(): Promise<unknown> }).dispose()
  })
})
