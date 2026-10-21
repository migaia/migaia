import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

/**
 * Builds the console-only `@migaia/logger` instance. Lives in its own module so `log.ts` can load
 * it on demand; no network plugin is installed and the sink forwards original arguments to the host
 * console. Construction failure falls back to the console and is reported there.
 */
export function createConsoleLogger(): { error(...args: unknown[]): void } {
  try {
    /** Page-lifetime logger; the level plugin supplies `error`. */
    const logger = new Logger({
      execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 },
      plugins: [level()]
    })
    logger.useSink((entry) => {
      logger.runtimeManager.console?.error(
        ...(entry.message ? [entry.message, ...entry.args] : entry.args)
      )
    })
    return { error: (...args) => logger.error(...(args as Parameters<typeof logger.error>)) }
  } catch (error) {
    console.error(error)
    return { error: (...args) => console.error(...args) }
  }
}
