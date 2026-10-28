/** Original construction cancellation and late failure use one actual public native installation. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, type IRpcFlowInstallation } from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

it('keeps caller cancellation terminal before reporting the original late setup failure', async (test) => {
  /** The real supported setup callback establishes its own original installation entry. */
  const entered = deferred<void>()
  /** Only the original setup's application-owned Promise controls its distinct late rejection. */
  const late = deferred<never>()
  /** This exact native object must remain the construction cancellation reason. */
  const reason = new DOMException('timeout late-reject abort', 'AbortError')
  /** This distinct original Error belongs to the same pending native setup invocation. */
  const latePrimary = new Error('timeout late-reject primary')
  /** Only the real public construction reporter contributes late failure observations. */
  const reports: unknown[] = []
  /** The same native prefix batch owns this one provisional resource before setup waits. */
  const resourceCleanup = { calls: 0 }
  /** Only NativeHost rollback invokes this acquired installation's original disposer. */
  const ownedInstallation: IRpcFlowInstallation = {
    stages: {},
    dispose() {
      resourceCleanup.calls += 1
    }
  }
  /** Earlier real setup lends its resource to the same transaction as the pending setup. */
  const resourceFlow = defineFlowPlugin({
    name: 'late-installation-owned-resource',
    setup: () => ownedInstallation
  })
  /** One actual caller controller cancels the same Host whose setup is pending. */
  const controller = new AbortController()
  /** Existing native memory transport admission remains part of this one real installation batch. */
  const server = coreMemoryServer('late-installation')
  /** This SDK flow setup executes inside the original native install, without role injection. */
  const flow = defineFlowPlugin({
    name: 'late-installation-flow',
    async setup() {
      entered.resolve()
      return await late.promise
    }
  })
  /** Observe the genuine opening immediately, preserving its native failure and caller identity. */
  const opening = createRpcHost({
    ...server.options,
    plugins: [resourceFlow, flow, server.transport],
    signal: controller.signal,
    report: (error) => reports.push(error)
  }).then(
    (host) => ({ host }),
    (error: unknown) => ({ error })
  )
  /** One test-end receipt borrows only the exact pending setup, failure and opening it releases. */
  const cleanup = { late, latePrimary, opening }
  /** The framework's own terminal cleanup releases an uncooperative setup even after test timeout. */
  test.onTestFinished(async () => {
    cleanup.late.reject(cleanup.latePrimary)
    const outcome = await cleanup.opening
    if ('host' in outcome) await outcome.host.close()
  })
  try {
    await entered.promise
    controller.abort(reason)
    /** Cancellation must settle before the original callback rejects; no synthetic race is added. */
    const outcome = await opening
    if (test.signal.aborted) return
    /** Reaching this public terminal is independent from the original setup's later failure. */
    const failure = 'error' in outcome ? outcome.error : undefined
    expect.soft(walkErrorCauses(failure).includes(reason)).toBe(true)
    expect.soft(failure).toMatchObject({ code: RpcCoreErrorCode.cancelled })
    expect(resourceCleanup.calls).toBe(1)
    expect(reports).toHaveLength(0)
    late.reject(latePrimary)
    await vi.waitFor(() => {
      /** Preserve the original strict Error reachability without another nested callback owner. */
      let reachable = false
      for (const error of reports)
        if (walkErrorCauses(error).includes(latePrimary)) {
          reachable = true
          break
        }
      expect(reachable).toBe(true)
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toBe(latePrimary)
    expect(resourceCleanup.calls).toBe(1)
  } finally {
    late.reject(latePrimary)
    await opening
  }
})

it('disposes the original late fulfilled setup once after caller cancellation is terminal', async (test) => {
  /** The real setup signals entry before the caller cancels this same installation. */
  const entered = deferred<void>()
  /** Hold the original setup output until the real opening has already rejected. */
  const late = deferred<IRpcFlowInstallation>()
  /** Count disposal of this one acquired installation, without another cleanup owner. */
  const disposal = { calls: 0 }
  /** The original setup output owns its exact cleanup callback and receiver. */
  const installation: IRpcFlowInstallation = {
    stages: {},
    dispose() {
      disposal.calls += 1
    }
  }
  /** The caller's original native reason must remain reachable from the cancellation terminal. */
  const reason = new DOMException('late fulfilled setup abort', 'AbortError')
  /** This actual caller controller cancels only the Host whose setup remains pending. */
  const controller = new AbortController()
  /** Existing memory transport admission participates in the same genuine installation batch. */
  const server = coreMemoryServer('late-fulfilled-installation')
  /** The supported flow callback retains its original pending application Promise. */
  const flow = defineFlowPlugin({
    name: 'late-fulfilled-installation-flow',
    async setup() {
      entered.resolve()
      return await late.promise
    }
  })
  /** Observe the original opening immediately so its cancellation cannot become unhandled. */
  const opening = createRpcHost({
    ...server.options,
    plugins: [flow, server.transport],
    signal: controller.signal
  }).then(
    (host) => ({ host }),
    (error: unknown) => ({ error })
  )
  /** Framework cleanup releases the same held setup output if the real opening fails to settle. */
  const cleanup = { late, installation, opening }
  test.onTestFinished(async () => {
    cleanup.late.resolve(cleanup.installation)
    const outcome = await cleanup.opening
    if ('host' in outcome) await outcome.host.close()
  })
  try {
    await entered.promise
    controller.abort(reason)
    /** The output remains held until the original cancellation terminal is observable. */
    const outcome = await opening
    if (test.signal.aborted) return
    /** Only the original opening failure supplies the reason and public cancellation code. */
    const failure = 'error' in outcome ? outcome.error : undefined
    expect(walkErrorCauses(failure).includes(reason)).toBe(true)
    expect(failure).toMatchObject({ code: RpcCoreErrorCode.cancelled })
    late.resolve(installation)
    await vi.waitFor(() => expect(disposal.calls).toBe(1))
  } finally {
    late.resolve(installation)
    await opening
  }
})

// /C009: preserve the original cancellation budget and throwing reporter.
it('settles native construction within 100ms and isolates a throwing original late-failure reporter', async (test) => {
  /** The actual setup signals entry before caller cancellation starts its original budget. */
  const entered = deferred<void>()
  /** The original setup cannot settle until cancellation and cleanup have been observed. */
  const late = deferred<never>()
  /** This exact caller reason remains reachable from the original cancellation terminal. */
  const reason = new DOMException('transaction diagnostic isolation', 'AbortError')
  /** A distinct original setup Error must reach the real public report callback once. */
  const latePrimary = new Error('transaction original late failure')
  /** The report callback's own exception must not replace the settled construction failure. */
  const reporterFailure = new Error('transaction diagnostic observer failed')
  /** Only this genuine earlier native installation owns the acquired cleanup callback. */
  const cleanupCalls = { value: 0 }
  /** The original user callback records actual reports without manufacturing a diagnostic. */
  const reports: unknown[] = []
  /** A real caller controller drives the same pending public construction. */
  const controller = new AbortController()
  /** This supported transport remains cold while the earlier setup is still pending. */
  const server = coreMemoryServer('transaction-late-reporter')
  /** Only the genuine native installation may release this original acquired receipt. */
  const installation: IRpcFlowInstallation = {
    stages: {},
    dispose() {
      cleanupCalls.value += 1
    }
  }
  /** Acquire cleanup through the same real native prefix transaction as the held setup. */
  const resource = defineFlowPlugin({
    name: 'transaction-late-resource',
    setup: () => installation
  })
  /** The supported setup callback alone owns the held application Promise. */
  const pending = defineFlowPlugin({
    name: 'transaction-late-setup',
    async setup() {
      entered.resolve()
      return await late.promise
    }
  })
  /** Observe the actual public terminal before cancellation can reject the original Promise. */
  const opening = createRpcHost({
    ...server.options,
    plugins: [resource, pending, server.transport],
    signal: controller.signal,
    report(error) {
      reports.push(error)
      throw reporterFailure
    }
  }).then(
    (host) => ({ host }),
    (error: unknown) => ({ error })
  )
  /** Framework termination releases the same original setup without adding a cancellation owner. */
  const cleanup = { late, latePrimary, opening }
  test.onTestFinished(async () => {
    cleanup.late.reject(cleanup.latePrimary)
    const outcome = await cleanup.opening
    if ('host' in outcome) await outcome.host.close()
  })
  /** This original 100ms observation timer is always cleared by this case. */
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await entered.promise
    controller.abort(reason)
    /** Retain the original explicit bound instead of relying on the framework's longer timeout. */
    const budget = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(resolve, 100, 'timeout')
    })
    /** Only genuine construction and the original observation timer compete for this result. */
    const outcome = await Promise.race([opening, budget])
    clearTimeout(timer)
    expect(outcome).not.toBe('timeout')
    /** No wrapper supplies a replacement error when the real construction has failed. */
    const failure = outcome !== 'timeout' && 'error' in outcome ? outcome.error : undefined
    expect(failure).toMatchObject({ code: RpcCoreErrorCode.cancelled })
    expect(walkErrorCauses(failure).includes(reason)).toBe(true)
    expect(cleanupCalls.value).toBe(1)
    expect(reports).toHaveLength(0)
    /** Observe only the existing host exception queue after real construction has settled. */
    const queued: VoidFunction[] = []
    /** Secondary reporter exceptions retain their canonical host queue and original identity. */
    const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      queued.push(callback)
    })
    try {
      late.reject(latePrimary)
      await vi.waitFor(() => expect(reports).toHaveLength(1))
      expect(reports[0]).toBe(latePrimary)
      expect(cleanupCalls.value).toBe(1)
      expect(queued).toHaveLength(1)
      /** Execute the original queued reporter failure only inside its identity observation. */
      let queuedFailure: unknown
      try {
        queued[0]!()
      } catch (error) {
        queuedFailure = error
      }
      expect(queuedFailure).toBe(reporterFailure)
      /** The original terminal stays fixed after the report callback itself throws. */
      const final = await opening
      expect('error' in final ? final.error : undefined).toBe(failure)
    } finally {
      queue.mockRestore()
    }
  } finally {
    clearTimeout(timer)
    late.reject(latePrimary)
    const outcome = await opening
    if ('host' in outcome) await outcome.host.close()
  }
})
