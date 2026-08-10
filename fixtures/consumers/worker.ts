import { createWebWorkerTransport } from '@migai/web-rpc/web-worker'

declare const self: DedicatedWorkerGlobalScope

const transport = createWebWorkerTransport(self)
transport.send({ kind: 'worker-consumer-contract' })
