/** Echo the transferred physical bytes to their actual sending Window. */
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!(event.data instanceof Uint8Array) || event.source !== window.parent) return
  window.parent.postMessage(event.data, event.origin, [event.data.buffer])
})
