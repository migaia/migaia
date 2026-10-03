import { BrowserBenchText } from './text.mjs'

/**
 * Receive the separate control port before any business listener or provider is installed.
 *
 * @returns {Promise<MessagePort>} Owned control port, excluded from measured echoes.
 */
export async function controlPort() {
  /** One initialization message transfers actual port ownership into this Worker. */
  const port = await new Promise((resolve) => {
    globalThis.onmessage = (event) => {
      globalThis.onmessage = null
      resolve(event.data.port)
    }
  })
  port.onmessage = () => {
    performance.mark(BrowserBenchText.workerMark)
    port.postMessage(BrowserBenchText.mark)
  }
  return port
}
