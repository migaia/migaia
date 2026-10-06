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
  /** One outstanding fixture exchange preserves the sequential DA1 business path. */
  let exchange
  /** Worker ownership belongs to this one isolated browser side. */
  let worker
  /** Independent control messages never enter the RPC envelope stream. */
  let control
  /** Complete error classifications are retained, with absent semantic reasons explicit. */
  const classification = { failures: [], rejections: [] }
  globalThis.benchPrepare = async (payloadBytes) => {
    /** The control port is set before the provider is constructed or readiness is acknowledged. */
    const channel = new MessageChannel()
    control = channel.port1
    /** Both sides allocate through this original page owner; RPC supplies it to its launcher. */
    let createWorker
    const ready = new Promise((resolve, reject) => {
      control.onmessage = () => resolve()
      /** Real allocation remains here; the RPC launcher calls this before its private bootstrap. */
      createWorker = () => {
        worker = new Worker(workerPath, { type: 'module' })
        worker.onerror = (event) => reject(new Error(event.message))
        worker.postMessage({ port: channel.port2 }, [channel.port2])
        return worker
      }
    })
    exchange = await activate(createWorker, 'x'.repeat(payloadBytes), classification)
    await ready
    await exchange()
  }
  globalThis.benchMark = async () => {
    performance.mark(BrowserBenchText.pageMark)
    await new Promise((resolve) => {
      control.onmessage = () => resolve()
      control.postMessage(BrowserBenchText.mark)
    })
  }
  globalThis.benchWarmup = async () => {
    for (let index = 0; index < 100; index++) await exchange()
  }
  globalThis.benchRun = async (samples) => {
    /** Raw issue-order latencies are saved in full; Playwright makes one call for the whole loop. */
    const latenciesNs = []
    const begin = performance.now()
    for (let index = 0; index < samples; index++) {
      const start = performance.now()
      try {
        await exchange()
      } catch (error) {
        classification.failures.push({
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
    return { latenciesNs, elapsedNs: (performance.now() - begin) * 1e6, classification }
  }
}
