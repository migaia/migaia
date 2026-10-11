/** Runtime-private fixtures use shared counters only for termination evidence, never RPC. */
self.addEventListener('message', (event) => {
  if (event.data.mode === 'error') throw new Error('web thread original failure')
  if (event.data.mode === 'busy') {
    const counter = new Int32Array(event.data.counter)
    while (true) Atomics.add(counter, 0, 1)
  }
  if (event.data.mode === 'natural') self.close()
})
