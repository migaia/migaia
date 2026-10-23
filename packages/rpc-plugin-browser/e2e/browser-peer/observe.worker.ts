/** The real SharedWorker accepts independent native port ownership. */
declare const self: SharedWorkerGlobalScope

/** Echo bytes on the same physical port, transferring their received buffer back. */
self.addEventListener('connect', (event) => {
  /** Each accepted connection owns its exact native echo port independently. */
  for (const port of event.ports) {
    /** Return the same physical bytes while applying a real receive-to-send transfer boundary. */
    port.addEventListener('message', (message: MessageEvent<Uint8Array>) => {
      port.postMessage(message.data, [message.data.buffer])
    })
    port.start()
  }
})
