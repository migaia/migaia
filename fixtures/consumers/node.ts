import { MessageChannel } from 'node:worker_threads'
import { createNodeMessagePortTransport } from '@migai/web-rpc/message-port'
import { Logger, type ILogEntry, type ISink } from '@migai/logger'

const sink: ISink = (entry: ILogEntry) => {
  void entry.message
}
new Logger({
  plugins: [{ name: 'consumer-sink', install: (core: any) => { core.useSink(sink); return {} } }] as const
})

const channel = new MessageChannel()
const transport = createNodeMessagePortTransport(channel.port1)

transport.send({ kind: 'node-consumer-contract' })
channel.port1.close()
channel.port2.close()
