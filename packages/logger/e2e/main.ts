import { Logger, setLoggerRuntimeManager } from '../src'
import { batch } from '../src/plugins/batch'
import { color } from '../src/plugins/color'
import { http } from '../src/plugins/http'
import { level } from '../src/plugins/level'
import { process } from '../src/plugins/process'
import { reasoning } from '../src/plugins/reasoning'
import { uuid } from '../src/plugins/uuid'

declare global {
  interface Window {
    runLoggerScenario(): Promise<void>
    runLoggerDeadlineScenario(): Promise<void>
    loggerScenarioResult?: {
      readonly requests: readonly string[]
      readonly requestHeaders: readonly Record<string, string>[]
    }
    loggerDeadlineElapsedMs?: number
  }
}

window.runLoggerScenario = async (): Promise<void> => {
  const requests: string[] = []
  const requestHeaders: Record<string, string>[] = []
  const restoreRuntime = setLoggerRuntimeManager({
    randomUUID: () => crypto.randomUUID(),
    defer: (task) => queueMicrotask(task),
    write: (text) => console.log(text),
    console,
    fetch: async (_input, init) => {
      requests.push(String(init?.body ?? ''))
      requestHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()))
      return { ok: true, status: 200, headers: { get: () => null } }
    }
  })
  const logger = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [
      batch({ maxSize: 2, maxWaitMs: 100 }),
      http({
        url: '/logger-e2e',
        authToken: 'e2e-token',
        headers: { 'X-Logger-E2E': 'enabled' },
        retries: 0,
        batch: { maxSize: 2 }
      }),
      level({
        level: 'info',
        filters: [(entry) => entry.message !== 'filtered by filter']
      }),
      color({ color: 'always', format: 'pretty', timestamp: false }),
      uuid({ display: true }),
      reasoning({ labels: { thinking: 'custom thinking', response: 'custom response' } }),
      process()
    ]
  })
  logger.debug('filtered by level')
  logger.info('filtered by filter')
  logger.info('browser info')
  logger.warn('browser warning')
  logger.error('browser error')
  logger.fatal('browser fatal')
  logger.setLevel('debug')
  logger.debug('debug after setLevel')
  const dynamicFilter = (entry: { message: string }) => entry.message !== 'filtered dynamically'
  const removeDynamicFilter = logger.addFilter(dynamicFilter)
  logger.info('filtered dynamically')
  removeDynamicFilter()
  logger.info('filter removed')
  logger.startThinking()
  logger.thinking('step')
  logger.endThinking()
  logger.startResponse()
  logger.response('answer')
  logger.endResponse()
  await logger.flush()
  await logger.shutdown('manual')
  restoreRuntime()
  window.loggerScenarioResult = { requests, requestHeaders }
}

window.runLoggerDeadlineScenario = async (): Promise<void> => {
  const logger = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  logger.useSink(() => new Promise<void>(() => undefined))
  logger.log('deadline', 'never-settling')
  const startedAt = performance.now()
  await logger.flush()
  window.loggerDeadlineElapsedMs = performance.now() - startedAt
}
