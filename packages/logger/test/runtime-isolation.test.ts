import { describe, expect, it } from 'vitest'
import { Logger, LoggerErrorCode, setLoggerRuntimeManager } from '../src/index.js'
import { http } from '../src/plugins/http.js'
import { color } from '../src/plugins/color.js'
import { uuid } from '../src/plugins/uuid.js'
import { file } from '../src/plugins/file.browser.js'

describe('instance host ownership', () => {
  it('keeps writes, console, UUID, HTTP and file capabilities on the instance after default replacement', async () => {
    /** Records actual adapter use, including the receiver-sensitive factory. */
    const calls: string[] = []
    /** Creates distinct capability objects without changing the process-global resource owner. */
    const manager = (label: string) => ({
      label,
      randomUUID() {
        return this.label
      },
      defer(task: () => void) {
        calls.push(`${this.label}:defer`)
        task()
      },
      write(text: string) {
        calls.push(`${this.label}:write:${text}`)
      },
      createAbortController() {
        calls.push(`${this.label}:controller`)
        return new AbortController()
      },
      console: {
        log: () => {
          calls.push(`${label}:console`)
        },
        warn: () => undefined,
        error: () => undefined
      },
      fetch: async () => {
        calls.push(`${label}:fetch`)
        return { ok: true, status: 200, headers: { get: () => null } }
      },
      fs: {
        append: async () => {
          calls.push(`${label}:file`)
        }
      }
    })
    /** Both logger instances keep different injected owners while the module default changes. */
    const firstOwner = manager('first')
    /** Second owner receives only the second logger's capabilities. */
    const secondOwner = manager('second')
    /** Third owner becomes the fallback for a logger created after the default replacement. */
    const thirdOwner = manager('third')
    /** One legal execution policy is shared as immutable test input. */
    const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
    /** Installs each adapter through its public plugin entry, not a private capability seam. */
    const first = new Logger({
      execution,
      runtimeManager: firstOwner,
      plugins: [
        uuid(),
        color({ color: 'never', format: 'json' }),
        http({ url: 'https://logger.test.invalid', retries: 0 }),
        file({ path: 'unused.jsonl', batch: { maxSize: 1 } })
      ]
    })
    /** Second logger uses independently instantiated plugins and host bindings. */
    const second = new Logger({ execution, runtimeManager: secondOwner })
    /** Captures the generated UUID field without inspecting plugin-private state. */
    const uuids: unknown[] = []
    first.useSink((entry) => {
      uuids.push(entry.data.uuid)
    })
    /** Restores the module fallback after proving it cannot retarget either live logger. */
    const restore = setLoggerRuntimeManager(thirdOwner)
    /** The newly created fallback logger captures the newly selected default. */
    const third = new Logger({ execution })
    try {
      expect(first.runtimeManager).toBe(firstOwner)
      expect(second.runtimeManager).toBe(secondOwner)
      expect(third.runtimeManager).toBe(thirdOwner)
      first.log('info', 'entry')
      first.raw('first-raw', { asyncOutput: true })
      second.raw('second-raw')
      third.raw('third-raw')
      await first.flush()
      expect(uuids).toEqual(['first'])
      expect(calls).toEqual(
        expect.arrayContaining([
          'first:controller',
          'first:console',
          'first:fetch',
          'first:file',
          'first:defer',
          'first:write:first-raw',
          'second:write:second-raw',
          'third:write:third-raw'
        ])
      )
      expect(calls).not.toContain('third:fetch')
      expect(calls).not.toContain('second:fetch')
    } finally {
      restore()
      await first.shutdown('manual')
      await second.shutdown('manual')
      await third.shutdown('manual')
    }
  })

  it('rejects an invalid runtime manager before plugin installation', () => {
    /** Plugin admission must remain untouched when the option has no required host methods. */
    let installs = 0
    expect(
      () =>
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          runtimeManager: {} as never,
          plugins: [
            {
              name: 'must-not-install',
              install: () => {
                installs++
                return {}
              }
            }
          ]
        })
    ).toThrow(expect.objectContaining({ code: LoggerErrorCode.invalidOption, name: 'TypeError' }))
    expect(installs).toBe(0)
  })
})
