import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { isThreadChild } from '@migaia/rpc-plugin-thread'

/** Native Node type stripping accepts erasable TypeScript when imports resolve to actual files. */
const child = await isThreadChild()
await createRpcHost({
  provide: { double: (value: number) => value * 2, child: () => child },
  plugins: [threadPlugin({ connectToParent: true })]
})
