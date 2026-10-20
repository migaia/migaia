import { writeFile } from 'node:fs/promises'
import { createProcessPeer } from '@migaia/rpc-process'

/** The parent selects a post-bootstrap crash only for the launched-handle case. */
const crashAfterReply = process.argv.includes('crash-after-reply')

/** The public automatic child path proves the original byte channel and stdin bootstrap survive. */
await createProcessPeer({
  provide: {
    /** Return the wrapper's environment; the crash starts only after an actual business call. */
    wrapped: () => {
      if (crashAfterReply) setTimeout(() => process.exit(3), 100)
      return process.env.TRAY_WRAPPED ?? null
    },
    /** Return the native write result so sandbox denial stays separate from RPC admission. */
    write: async (path: string) => {
      try {
        await writeFile(path, 'launch-wrap fixture')
        return { wrote: true }
      } catch (error) {
        return {
          wrote: false,
          code: error && typeof error === 'object' && 'code' in error ? error.code : null
        }
      }
    }
  }
})
