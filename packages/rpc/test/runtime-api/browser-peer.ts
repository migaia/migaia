import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createBrowserThreadLauncher,
  createBrowserThreadChannelFactory
} from '../../src/threads/adapters/browser.js'

/** Playwright loads this owning-package fixture through the existing Vite scenario entry. */
globalThis.runAutomaticThreadScenario = async () => {
  /** The actual native Worker handle retains lifecycle capabilities independently from messaging. */
  let handle:
    | Awaited<ReturnType<ReturnType<typeof createBrowserThreadLauncher>['launch']>>
    | undefined
  /** Genuine reverse calls are counted in parent business, independently from child metadata. */
  let reverseCalls = 0
  /** A constructed canonical Peer alone owns endpoint/channel disposal. */
  let parent: IRuntimePeer | undefined
  /** Preparation errors remain visible to the actual browser assertion. */
  const failures: string[] = []
  /** Unsupported actual exit must remain unresolved rather than being guessed from terminate. */
  let exited = false
  try {
    parent = await createThreadPeer<IRuntimeDynamicSurface>({
      self: { name: 'browser-parent', instanceId: 'browser-automatic-parent' },
      provide: {
        parentEcho: () => {
          reverseCalls += 1
          return parent!.self.instanceId
        }
      },
      spawn: async (context) => {
        const launcher = createBrowserThreadLauncher({
          runtimeApi: context,
          report: (error) => {
            failures.push(String((error as { code?: string }).code))
          }
        })
        handle = await launcher.launch(
          {
            entry: new URL('./fixtures/browser-worker.ts', import.meta.url).href,
            name: 'browser-automatic-child'
          },
          { signal: new AbortController().signal }
        )
        void handle.exited.then(() => {
          exited = true
        })
        return createBrowserThreadChannelFactory({ scheduler: systemScheduler }).open(
          handle,
          new AbortController().signal
        )
      },
      report: (error) => {
        failures.push(String((error as { code?: string }).code))
      }
    })
    /** Both endpoints execute real providers through the independently agreed runtime directory. */
    const result = (await parent.request('probe', 'browser-ready')) as {
      value: string
      self: { name: string; instanceId: string }
      parent: string
    }
    /** This genuine Web Worker has no supported local isolate sampler; no parent values substitute. */
    const resources = (await parent.describe()).connections[0]!.resources
    /** The real Web Worker accepts the implemented profile through independent native offers. */
    const group = await parent.group(
      [{ method: 'value' }, { method: 'fail' }, { method: 'value' }],
      { orderKey: 'group' }
    )
    const replayed = [
      await parent.request('value', undefined, { orderKey: 'value', idempotencyKey: 'sealed' }),
      await parent.request('value', undefined, { orderKey: 'value', idempotencyKey: 'sealed' })
    ]
    await parent.notify('value', undefined, {
      orderKey: 'notify',
      cancel: 'before-start',
      idempotencyKey: 'notify'
    })
    /** A physical notify completion is followed by a read-only observation of real final settlement. */
    let notified = await parent.outcome('notify')
    for (let attempt = 0; notified.state !== 'done' && attempt < 100; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      notified = await parent.outcome('notify')
    }
    const controller = new AbortController()
    const stream = parent.stream('values', undefined, {
      orderKey: 'stream',
      cancel: 'before-start',
      signal: controller.signal,
      idempotencyKey: 'stream'
    })
    const first = await stream.next()
    controller.abort()
    const terminal = await stream.return!()
    const atomic = {
      group: group.map((step) => step.state),
      replayed,
      sealed: await parent.outcome('sealed'),
      notified,
      first,
      terminal,
      streamed: await parent.outcome('stream')
    }
    return {
      atomic,
      result,
      reverseCalls,
      fingerprint: handle!.identity.fingerprint,
      failures,
      exited,
      resources
    }
  } finally {
    try {
      await parent?.close()
    } finally {
      handle?.terminate()
    }
  }
}

declare global {
  var runAutomaticThreadScenario: () => Promise<unknown>
}
