import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { isProcessChild } from '@migaia/rpc-plugin-process'

/** The fixture intentionally has no relative .js imports, so Node 24 can strip its types. */
await createRpcHost({
  provide: {
    math: { double: (value: number) => value * 2 },
    child: () => isProcessChild(),
    flags: () => process.execArgv
  },
  plugins: [processPlugin({ connectToParent: true })]
})
