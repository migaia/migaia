import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

/** Native Node type stripping accepts erasable TypeScript when imports resolve to actual files. */
const child = await isThreadChild()
await createThreadPeer({
  provide: { double: (value: number) => value * 2, child: () => child }
})
