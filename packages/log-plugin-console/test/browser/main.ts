import { defineLogPlugin } from '@migaia/log-host/plugin'
import { createLogHost, levelPlugin, type ILogEntry, type ILogPluginCore } from '@migaia/log-host'
import {
  batchFeature,
  filterFeature,
  thresholdFeature,
  uuidFeature
} from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'
import { httpPlugin } from '@migaia/log-plugin-http'
import { processPlugin } from '@migaia/log-plugin-process'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

/** Browser observations retain the old fixture's actual request payloads and normalized headers. */
type IBrowserScenarioResult = {
  readonly requests: readonly string[]
  readonly requestHeaders: readonly Record<string, string>[]
}
/** Derive the injected fetch request directly from the public HTTP plugin contract. */
type IHttpRequestInit = Parameters<NonNullable<Parameters<typeof httpPlugin>[0]['fetcher']>>[1]

declare global {
  /** Declaration merging publishes only the two original browser scenarios and their results. */
  interface Window {
    runLoggerScenario(): Promise<void>
    runLoggerDeadlineScenario(): Promise<void>
    loggerScenarioResult?: IBrowserScenarioResult
    loggerDeadlineElapsedMs?: number
  }
}

/** The supplied fetch capability records requests without calling an external endpoint. */
class BrowserRequests {
  /** Each body belongs to one actual HTTP output delivery. */
  #requests: string[] = []
  /** Header normalization follows the native browser Headers implementation. */
  #requestHeaders: Record<string, string>[] = []

  /** Fulfill the real HTTP attempt only after recording its unmodified body and headers. */
  async fetch(_url: string, init: IHttpRequestInit): Promise<Response> {
    this.#requests.push(init.body)
    this.#requestHeaders.push(Object.fromEntries(new Headers(init.headers).entries()))
    return new Response(null, { status: 200 })
  }

  /** Publish observations after the original owning host has fully drained and shut down. */
  result(): IBrowserScenarioResult {
    return { requests: this.#requests, requestHeaders: this.#requestHeaders }
  }
}

/** A supported plugin installation retains the never-settling sink on its real host. */
class NeverSettlingBrowserSink {
  /** Stable registration identity belongs to this single browser deadline fixture. */
  readonly name = 'browser-never-settling-sink'
  /** This deliberately unfinished operation is the original flush deadline subject. */
  #pending = new Promise<void>(() => undefined)

  /** Register through the public plugin core instead of restoring the removed facade method. */
  install(core: ILogPluginCore): Record<string, never> {
    core.useSink(() => this.#pending)
    return {}
  }
}

/** Keep the original initial message predicate independently of live filter registrations. */
function keepInitialEntry(entry: ILogEntry): boolean {
  return entry.message !== 'filtered by filter'
}

/** Removing this registration must permit the subsequent explicitly allowed message. */
function keepDynamicEntry(entry: ILogEntry): boolean {
  return entry.message !== 'filtered dynamically'
}

/** Exercise the preserved browser outputs through their new public package owners. */
async function runLoggerScenario(): Promise<void> {
  /** One instance records only this scenario's borrowed transport calls. */
  const requests = new BrowserRequests()
  /** The live threshold now belongs to its explicit host feature. */
  const threshold = thresholdFeature({ level: 'info' })
  /** Initial and removable predicates retain independent registrations. */
  const filters = filterFeature({ filters: [keepInitialEntry] })
  /** Every observed output consumes the same host entries and native browser capabilities. */
  const logger = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },

    plugins: [
      defineLogPlugin({
        name: 'policy',
        features: { threshold: threshold, filter: filters, uuid: uuidFeature({ display: true }) }
      }),
      levelPlugin(),
      httpPlugin({
        url: '/logger-e2e',
        fetcher: (url, init) => requests.fetch(url, init),
        authToken: 'e2e-token',
        headers: { 'X-Logger-E2E': 'enabled' },
        features: { batch: batchFeature({ maxSize: 2, maxWaitMs: 100 }) }
      }),
      consolePlugin({ features: { pretty: prettyFeature({ color: 'always', timestamp: false }) } }),
      reasoningPlugin({ labels: { thinking: 'custom thinking', response: 'custom response' } }),
      processPlugin()
    ]
  })
  logger.debug('filtered by level')
  logger.info('filtered by filter')
  logger.info('browser info')
  logger.warn('browser warning')
  logger.error('browser error')
  logger.fatal('browser fatal')
  // Finish this policy epoch before changing the carrier's installed threshold.
  await logger.flush()
  logger.policy_threshold_setLevel('debug')
  logger.debug('debug after setLevel')
  /** The returned capability revokes only the dynamically added predicate. */
  const removeDynamicFilter = logger.policy_filter_add(keepDynamicEntry)
  logger.info('filtered dynamically')
  await logger.flush()
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
  window.loggerScenarioResult = requests.result()
}

/** Preserve the original native-clock deadline scenario without a global runtime-manager seam. */
async function runLoggerDeadlineScenario(): Promise<void> {
  /** Only the real host and installed sink participate in the three-second drain. */
  const logger = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [new NeverSettlingBrowserSink()]
  })
  logger.log('deadline', 'never-settling')
  /** Record the same interval as the old fixture: entry admission through flush settlement. */
  const startedAt = performance.now()
  await logger.flush()
  window.loggerDeadlineElapsedMs = performance.now() - startedAt
}

window.runLoggerScenario = runLoggerScenario
window.runLoggerDeadlineScenario = runLoggerDeadlineScenario
