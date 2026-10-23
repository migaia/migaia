import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/** The real child uses only the public host and process transport entries. */
await createRpcHost({
  plugins: [processPlugin({ connectToParent: true })],
  provide: {
    echo: (value: unknown) => value,
    stderr: () => {
      process.stderr.write('private-process-feature-stderr\n')
      return process.pid
    }
  }
})
