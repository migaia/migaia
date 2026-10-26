import { isMainThread } from 'node:worker_threads'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { NativeIdentityChild } from './native-identity-child.ts'

/** The real Node process/Worker chooses its own supported public parent acquisition path. */
async function openNativeChild(): Promise<void> {
  /** One original child service owns the actual configured self, diagnostics and public provider. */
  const child = new NativeIdentityChild()
  await child.open(
    isMainThread
      ? processPlugin({ connectToParent: true })
      : threadPlugin({ connectToParent: true })
  )
}

/** Construction failure is handled locally rather than becoming an unhandled top-level rejection. */
void openNativeChild().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
