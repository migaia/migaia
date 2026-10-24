import { BrowserBenchText } from './text.mjs'

/**
 * Install one browser side; every measured round trip stays inside the page's monotonic clock.
 *
 * @param {string} workerPath Side-specific Worker bundle, with RPC absent from the bare bundle.
 * @param {(
 *   createWorker: () => Worker,
 *   payload: string,
 *   classification: object
 * ) => Promise<() => Promise<void>>} activate
 *   Echo constructor.
 * @returns {void} Publishes fixture controls consumed by the standalone Chromium driver.
 */
export function installPage(workerPath, activate) {
  new BrowserPage(workerPath, activate).install()
}

/** One isolated page owns the original Worker, control port, echo and full error classification. */
class BrowserPage {
  /** Fixed bundle path remains independent for bare and RPC sides. */
  #workerPath
  /** Original echo constructor keeps its receiver-free invocation and native ownership. */
  #activate
  /** One outstanding exchange preserves the original sequential budget business path. */
  #exchange
  /** Worker remains owned by this original isolated page fixture. */
  #worker
  /** Independent control messages never enter the RPC envelope stream. */
  #control
  /** Every failure/rejection retains the original complete semantic classification. */
  #classification = { failures: [], rejections: [] }
  /** @param {string} workerPath Original bundle. @param {Function} activate Original constructor. */
  constructor(workerPath, activate) {
    this.#workerPath = workerPath
    this.#activate = activate
  }
  /** @returns {void} Publish the same four original driver controls without starting a Worker. */
  install() {
    globalThis.benchPrepare = this.#prepare
    globalThis.benchMark = this.#mark
    globalThis.benchWarmup = this.#warmup
    globalThis.benchRun = this.#run
  }
  /**
   * @param {number} payloadBytes Original fixed payload size. @returns {Promise<void>} Actual
   *   readiness and first echo.
   */
  #prepare = async (payloadBytes) => {
    /** Control is installed before provider construction or native readiness acknowledgement. */
    const channel = new MessageChannel()
    this.#control = channel.port1
    /** Real allocation remains owned by this page even when the native RPC launcher requests it. */
    let createWorker
    /** Preserve the same original native readiness Promise and error boundary. */
    const ready = new Promise((resolve, reject) => {
      this.#control.onmessage = () => resolve()
      createWorker = () => {
        this.#worker = new Worker(this.#workerPath, { type: 'module' })
        this.#worker.onerror = (event) => reject(new Error(event.message))
        this.#worker.postMessage({ port: channel.port2 }, [channel.port2])
        return this.#worker
      }
    })
    this.#exchange = await (0, this.#activate)(
      createWorker,
      'x'.repeat(payloadBytes),
      this.#classification
    )
    await ready
    await (0, this.#exchange)()
  }
  /** @returns {Promise<void>} Keep the same user timing mark and actual Worker acknowledgement. */
  #mark = async () => {
    performance.mark(BrowserBenchText.pageMark)
    await new Promise((resolve) => {
      this.#control.onmessage = () => resolve()
      this.#control.postMessage(BrowserBenchText.mark)
    })
  }
  /** @returns {Promise<void>} Retain the original fixed 100 sequential warm-up exchanges. */
  #warmup = async () => {
    for (let index = 0; index < 100; index++) await (0, this.#exchange)()
  }
  /**
   * @param {number} samples Original requested sample count. @returns {Promise<object>} Complete
   *   issue-order latencies and classification.
   */
  #run = async (samples) => {
    /** Every original settled latency remains in the same raw issue-order array. */
    const latenciesNs = []
    /** Formal timing still begins in the page's monotonic clock, after preparation and warm-up. */
    const begin = performance.now()
    for (let index = 0; index < samples; index++) {
      /** Each same-clock interval covers only its original awaited echo. */
      const start = performance.now()
      try {
        await (0, this.#exchange)()
      } catch (error) {
        this.#classification.failures.push({
          source: error?.source ?? null,
          code: error?.code ?? null,
          name: error?.name ?? typeof error,
          reason: error?.reason ?? null,
          message: String(error?.message ?? error).replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
        })
        throw error
      }
      latenciesNs.push((performance.now() - start) * 1e6)
    }
    return {
      latenciesNs,
      elapsedNs: (performance.now() - begin) * 1e6,
      classification: this.#classification
    }
  }
}
