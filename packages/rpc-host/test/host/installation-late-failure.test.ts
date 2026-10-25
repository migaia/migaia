/** Original construction cancellation and late failure use one actual public native installation. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, type IRpcFlowInstallation } from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

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
    plugins: [flow, server.transport],
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
