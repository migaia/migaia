import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Logger } from '../src/log.js'
import type { ILogEntry } from '../src/typing.js'

describe('logger invocation ownership', () => {
  it('MRC-SOL-F01 keeps hook registration and fireHook behavior observable at the Logger boundary', () => {
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const seen: string[] = []
    logger.hook('custom', () => {
      seen.push('first')
      logger.hook('custom', () => {
        seen.push('late')
      })
    })

    logger.fireHook('custom', {} as ILogEntry)

    expect(seen).toEqual(['first', 'late'])
  })

  it('MRC-SOL-F02 removes all exact-identity registrations and permits clean re-registration', () => {
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const seen: string[] = []
    const hook = (): void => {
      seen.push('hook')
    }
    const releaseOne = logger.hook('custom', hook)
    logger.hook('custom', hook)

    releaseOne()
    logger.fireHook('custom', {} as ILogEntry)
    expect(seen).toEqual([])

    logger.hook('custom', () => {
      seen.push('replacement')
    })
    logger.fireHook('custom', {} as ILogEntry)
    expect(seen).toEqual(['replacement'])
  })

  it('MRC-SOL-F02 keeps the named hook map as a derived exact-channel route', () => {
    const source = readFileSync(new URL('../src/log.ts', import.meta.url), 'utf8')
    expect(source).toContain(
      'if (channel.size === 0 && this.#hooks.get(name) === channel) this.#hooks.delete(name)'
    )
  })
})
