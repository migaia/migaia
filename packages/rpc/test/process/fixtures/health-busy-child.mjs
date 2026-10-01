/** Serve the real native RPC stack before deliberately blocking its event loop. */
import './node-process-plugin-child.mjs'

/** The parent observes this acknowledgement before advancing its health clock. */
process.on('SIGUSR2', () => {
  process.stderr.write('busy-loop-entered\n', () => {
    while (true) {
      // Non-cooperative provider work leaves the RPC control plane unavailable.
    }
  })
})
