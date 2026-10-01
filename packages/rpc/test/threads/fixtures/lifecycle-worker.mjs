import { parentPort, workerData } from 'node:worker_threads'
import { readThreadBootstrap } from '../../../dist/threads/index.js'

/** The same public decoder gives the worker its own address and original business data. */
const { peerId, data } = readThreadBootstrap(workerData)
if (data?.mode === 'echo') {
  parentPort.postMessage({ peerId, data })
  parentPort.close()
} else if (data?.mode === 'error') throw new Error('thread original failure')
else if (data?.mode === 'natural') parentPort.close()
else if (data?.mode === 'heap') {
  const arrays = []
  while (true) arrays.push(Array.from({ length: 100000 }, () => 'retained'))
} else setInterval(() => parentPort.postMessage('tick'), 1)
