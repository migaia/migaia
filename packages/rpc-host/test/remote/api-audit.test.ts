import { expect, it, vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createRemotePlugin, createRemoteRetryPort } from '../../dist/remote/index.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { deferred } from '@migaia/utils/promise'
import { MessageChannel } from 'node:worker_threads'
import { walkErrorCauses } from '@migaia/utils/error'
import { remoteHarness, REMOTE_FIXTURE_CONTRACT } from './fixture.js'

it('releases an owned supervisor resource after its endpoint close fails', async () => {
  /** The external supervisor owns a real physical resource behind its opaque unit handle. */
  const physical = new MessageChannel()
  /** Native close observation proves release, independently of a mocked invocation count. */
  let physicalClosed = false
  /** Final cleanup awaits the actual native close callback even if the regression assertion fails. */
  const closed = deferred<void>()
  physical.port1.on('close', () => {
    physicalClosed = true
    closed.resolve()
  })
  /** Complete external binding ports keep native unit disposal under their original owner. */
  const fixture = remoteHarness()
  /** The endpoint fails first, while channel and owned supervisor still require cleanup. */
  const original = new Error('audit owned endpoint close failed')
  /** The original external supervisor operation releases its actual held physical ports. */
  const dispose = vi.spyOn(fixture.supervisor, 'dispose').mockImplementation(async () => {
    physical.port1.close()
    physical.port2.close()
    await closed.promise
  })
  /** Actual public Plugin installation and removal own the generation holder under test. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** The endpoint's existing operation supplies the original close rejection. */
  const closeEndpoint = vi.spyOn(fixture.served.endpoint, 'dispose').mockRejectedValue(original)
  /** The channel remains a distinct owned release operation after endpoint failure. */
  const closeChannel = vi.spyOn(fixture.channel, 'close')
  try {
    await host.use(
      createRemotePlugin({
        name: 'p',
        contract: REMOTE_FIXTURE_CONTRACT,
        binding: { ...fixture.binding, ownership: 'owned' },
        endpointFactory: async () => fixture.served,
        host: host.plugin,
        report: () => {}
      })
    )
    /** Physical release and original failure traceability both survive the owned cleanup path. */
    const outcome = await host.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(physicalClosed).toBe(true)
    expect(closeChannel).toHaveBeenCalledTimes(1)
    expect(outcome.cleanupErrors.some((error) => walkErrorCauses(error).includes(original))).toBe(
      true
    )
  } finally {
    await host.dispose()
    physical.port1.close()
    physical.port2.close()
    await closed.promise
    dispose.mockRestore()
    closeEndpoint.mockRestore()
    closeChannel.mockRestore()
  }
})

it('sends a late reporter throw to the shared host queue without an unhandled reaction Promise', async () => {
  /** The real physical send rejects only after the logical generation has departed. */
  const sending = deferred<never>()
  /** The late send failure and the reporter's secondary failure have separate identities. */
  const late = new Error('audit late send failure')
  /** The existing host exception queue must retain this exact callback error. */
  const reporterFailure = new Error('audit reporter failure')
  /** The complete public event port publishes actual synchronous departure. */
  let leave: ((reason: unknown) => void) | undefined
  /**
   * Capturing host exception callbacks prevents the deliberate reporter failure from crashing
   * tests.
   */
  const queued: VoidFunction[] = []
  /** Only this isolated reporter observation replaces the existing native queue operation. */
  const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
    queued.push(task)
  })
  /** This supported generation port needs no native unit or private owner metadata. */
  const events = {
    current: () => ({ generation: 1, active: true }),
    onLeave(_generation: number, listener: (reason: unknown) => void) {
      leave = listener
      return () => {
        leave = undefined
      }
    },
    whenReady: async () => 2
  }
  /** A user reporter may throw while handling the genuine late physical rejection. */
  const port = createRemoteRetryPort({
    events,
    scheduler: systemScheduler,
    report(error) {
      if (error === late) throw reporterFailure
    }
  })
  try {
    /** Non-idempotent execution becomes unknown at departure and is not replayed. */
    const operation = port.dispatch({
      method: 'p.f.request',
      mode: 'request',
      idempotent: false,
      generation: 1,
      events,
      sendOnce: () => sending.promise
    })
    leave!(new Error('audit generation departed'))
    await expect(operation).rejects.toMatchObject({ code: 'REMOTE_RESULT_UNKNOWN' })
    sending.reject(late)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(queued).toHaveLength(1)
    expect(() => queued[0]!()).toThrow(reporterFailure)
  } finally {
    enqueue.mockRestore()
  }
})

it('closes a departed generation channel even when its endpoint close rejects', async () => {
  /** Public complete binding ports supply actual generation exit and release operations. */
  const fixture = remoteHarness()
  /** The application endpoint's failure remains the original reported object. */
  const original = new Error('audit endpoint close failed')
  /** A real Host owns this public remote Plugin's generation holder. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Existing port operations remain independently observable. */
  const closeEndpoint = vi.spyOn(fixture.served.endpoint, 'dispose').mockRejectedValue(original)
  /** The channel release must execute once even when endpoint release fails first. */
  const closeChannel = vi.spyOn(fixture.channel, 'close')
  /** Reports use the application's existing trusted callback. */
  const report = vi.fn()
  try {
    await host.use(
      createRemotePlugin({
        name: 'p',
        contract: REMOTE_FIXTURE_CONTRACT,
        binding: fixture.binding,
        endpointFactory: async () => fixture.served,
        host: host.plugin,
        report
      })
    )
    fixture.emit({ type: 'exit', generation: 1, unit: 'unit', error: original } as never)
    await expect.poll(() => report.mock.calls.length).toBe(1)
    expect(closeEndpoint).toHaveBeenCalledTimes(1)
    expect(closeChannel).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(original)
  } finally {
    await host.dispose()
    closeEndpoint.mockRestore()
    closeChannel.mockRestore()
  }
})
