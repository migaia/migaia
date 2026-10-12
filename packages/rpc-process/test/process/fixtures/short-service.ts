import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

/** The fixture intentionally has no relative .js imports, so Node 24 can strip its types. */
await createProcessPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    child: () => isProcessChild(),
    flags: () => process.execArgv
  }
})
