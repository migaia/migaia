import { createMemoryTransportPair } from '@migai/web-rpc/memory'

const [client, server] = createMemoryTransportPair()
const unsubscribe = server.subscribe(() => undefined)

client.send({ kind: 'bun-consumer-contract' })
unsubscribe()
client.close()
