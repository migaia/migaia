import { parentPort } from 'node:worker_threads'

/** Report the native clone's actual bytes; this fixture implements no RPC dispatcher or security. */
parentPort.on('message', (value) => {
  parentPort.postMessage({ bytes: [...new Uint8Array(value)], length: value.byteLength })
})
