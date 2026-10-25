import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'

/** This genuine Node child reads the actual private stdin bootstrap before accepting its parent. */
const opening = createRpcHost({
  plugins: [processPlugin({ connectToParent: true })],
  provide: {
    child: () => isProcessChild(),
    pid: () => process.pid,
    echo: (value: unknown) => value,
    sequence: async function* () {
      yield 1
      yield 2
    },
    reverse: async (value: number): Promise<unknown> =>
      (await opening).process.send('parent', 'double', value),
    identity: async (): Promise<unknown> => (await opening).process.members.list()
  },
  report: () => undefined
})
await opening
