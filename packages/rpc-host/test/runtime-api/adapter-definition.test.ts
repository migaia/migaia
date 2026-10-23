import type { IAbortSignal } from '@migaia/utils/promise'
import { Worker } from 'node:worker_threads'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { it, expect, vi, type MockInstance } from 'vitest'
import { constructDefinitionPlugin } from '../../dist/runtime-adapter/definition.js'
import { defineMessageAdapter } from '../../dist/adapter.js'

it('Host cancellation during actual launch terminates the unit once and retains its reason', async () => {
  /** This physical unit is constructed only by the SDK's actual launch callback. */
  let worker: Worker | undefined
  /** Native termination remains real while the test counts invocations independently. */
  let terminate: MockInstance<Worker['terminate']> | undefined
  /** Actual exit observation proves the launched unit stopped rather than merely requesting stop. */
  let exited: Promise<{ code: number }> | undefined
  /** Native acquisition signals the point where Host disposal races the pending launch return. */
  let launchedResolve!: () => void
  /** The test never substitutes a bootstrap marker or accepted channel. */
  const launched = new Promise<void>((resolve) => {
    launchedResolve = resolve
  })
  /** A native launch may finish asynchronously after its original Host operation is canceled. */
  let releaseLaunch!: () => void
  /** This single gate delays only the launch result, without inventing a second lifecycle owner. */
  const launchGate = new Promise<void>((resolve) => {
    releaseLaunch = resolve
  })
  /** The genuine public Host operation supplies its own cancellation signal and primary reason. */
  let signal: IAbortSignal | undefined
  /** The SDK's own rejection is distinct from Host's earlier public cancellation race. */
  let settleSdkFailure!: (reason: unknown) => void
  /** Observe the exact rejection before Host decides whether to report a late settlement. */
  const sdkFailure = new Promise<unknown>((resolve) => {
    settleSdkFailure = resolve
  })
  /** Native/reporting failures remain observable while the expected cancellation echo is suppressed. */
  const reports: unknown[] = []
  /** Opening is unused for spawn, but its implementation would return the same actual native I/O. */
  const open = vi.fn(() => worker!)
  /** This definition owns raw Worker operations, without asserted trust or a synthetic Peer. */
  const adapter = defineMessageAdapter<string>({
    open,
    launch: async () => {
      // An actual parent message reader keeps this native unit alive until its owner terminates it.
      worker = new Worker("require('node:worker_threads').parentPort.on('message', () => {})", {
        eval: true
      })
      worker.on('error', (error) => reports.push(error))
      terminate = vi.spyOn(worker, 'terminate')
      exited = new Promise((resolve) => worker!.once('exit', (code) => resolve({ code })))
      launchedResolve()
      await launchGate
      return {
        port: worker,
        exited,
        terminate: () => {
          void worker!.terminate()
        }
      }
    }
  })
  /** SDK Plugin installation is the genuine provenance path that carries initialSignal to Core. */
  const sdkPlugin = constructDefinitionPlugin(adapter, {
    name: 'cancelled-launch',
    spawn: 'unit',
    peerId: 'not-yet-connected',
    report: (error) => reports.push(error)
  })
  /** Pass the original Host core directly to the real SDK hook and observe its exact attempt. */
  const plugin = definePlugin({
    ...sdkPlugin,
    install: async (core) => {
      signal = core.operation.signal
      try {
        return await sdkPlugin.install(core)
      } catch (error) {
        settleSdkFailure(error)
        throw error
      }
    }
  })
  /** No artificial mutation deadline is needed; real Host disposal cancels this pending use. */
  const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Observe rejection immediately so cancellation cannot leave an unhandled install Promise. */
  const installing = host.use(plugin).catch((error: unknown) => error)
  try {
    await launched
    /** Host teardown aborts the existing operation while launch still has not returned its unit. */
    const disposing = host.dispose()
    await expect.poll(() => signal?.aborted).toBe(true)
    /** Keep the exact public operation reason, rather than matching a copied code or message. */
    const reason = signal!.reason
    releaseLaunch()
    await expect.poll(() => terminate?.mock.calls.length).toBe(1)
    await exited
    /** SDK cleanup retains its exact primary even when Host has already rejected its public use. */
    expect(await sdkFailure).toBe(reason)
    await installing
    expect(open).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledTimes(1)
    await disposing
  } finally {
    releaseLaunch()
    await host.dispose()
    // Failed assertions still reclaim only the actual native unit created by this test.
    if (worker && worker.threadId !== -1) await worker.terminate()
    await exited
    terminate?.mockRestore()
  }
})
