/** Original provider failure cleanup is observed through actual public hosts and native flows. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowFeature, type IRpcFlowStages } from '@migaia/rpc-host/sdk'
import { limits } from '@migaia/rpc-host/plugins/limits'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { createRpcSchemaValidationError } from '../../dist/host/error-owner.js'
import { coreMemoryServer } from '../host/core-fixture.js'

it('releases admission and the original request identity when params validation fails', async () => {
  /** This exact native error is created by the existing canonical application error factory. */
  const validation = createRpcSchemaValidationError('invalid params', { field: 'data' })
  /** The real optional plugin performs validation after the actual limits admission hook. */
  const validator = defineFlowFeature({
    name: 'provider-result-validation',
    setup: () => ({
      stages: {
        dispatchInbound: (payload, next) => {
          const { context } = payload
          if (context.envelope.kind === 'call' && context.envelope.payload === 'invalid')
            throw validation
          return next(payload)
        }
      }
    })
  })
  /** Only a valid call may enter this original business provider. */
  const provider = vi.fn((value: unknown) => value)
  /** Reports preserve the original validation object independently from its wire graph. */
  const reports: unknown[] = []
  /** Both requests use the same accepted native binding and shared capacity-one quota owner. */
  const listener = coreMemoryServer('provider')
  /** The genuine native flow prefix fixes validation after quota admission and before business. */
  const host = await createRpcHost({
    ...listener.options,
    plugins: [limits({ maxGlobal: 1, maxPerPeer: 1 }), validator, ...listener.options.plugins!],
    provide: { test: provider },
    report: (error) => reports.push(error)
  })
  /** A real Session supplies verified source facts rather than a mocked retainBinding callback. */
  const client = await listener.connect('peer')
  try {
    await expect(client.host.memory.request('test', 'invalid')).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
      data: { field: 'data' }
    })
    expect(provider).not.toHaveBeenCalled()
    expect(client.pair[0].written.filter((frame) => frame.kind === 'error')).toHaveLength(1)
    expect(reports).toContain(validation)
    /** Actual success through the same identity proves both quota dimensions were released. */
    expect(await client.host.memory.request('test', 'next')).toBe('next')
    expect(provider).toHaveBeenCalledTimes(1)
    expect(client.pair[0].unsubscribed).toBe(0)
  } finally {
    await client.host.close()
    await host.close()
  }
})

// RPC-TEST-784B581CEDC7-C003: original provider-side Promise shape is BC3; real IO/lease duties remain.
it('releases same-session capacity when the validation error reply write fails', async () => {
  /** This original validation failure occurs after the actual capacity-one admission. */
  const validation = createRpcSchemaValidationError('invalid params', { field: 'data' })
  /** Sibling callbacks keep the real dispatch hook within its native setup owner. */
  const stages: IRpcFlowStages = {
    dispatchInbound: (payload, next) => {
      const { context } = payload
      if (context.envelope.kind === 'call' && context.envelope.payload === 'invalid')
        throw validation
      return next(payload)
    }
  }
  /** The complete native definition adds validation without another provider or lease. */
  const validator = defineFlowFeature({
    name: 'provider-result-write-failure-validation',
    setup: () => ({ stages })
  })
  /** The exact native physical failure must remain reachable through the public reporter. */
  const feedback = { failure: new Error('transport failed'), reported: deferred<unknown>() }
  /** Only the valid second call can enter this original business method. */
  const provider = vi.fn((value: unknown) => value)
  /** Both calls retain one actual accepted source and both capacity-one quota dimensions. */
  const listener = coreMemoryServer('provider-write-failure')
  /** Report observes the real Session error boundary, never an invented response to the caller. */
  const host = await createRpcHost({
    ...listener.options,
    plugins: [limits({ maxGlobal: 1, maxPerPeer: 1 }), validator, ...listener.options.plugins!],
    provide: { test: provider },
    report: (error) => {
      if (walkErrorCauses(error).includes(feedback.failure)) feedback.reported.resolve(error)
    }
  })
  /** Original native handshake finishes before failure injection touches a business reply. */
  const client = await listener.connect('peer')
  /** Retain the genuine physical write and only one selected native failure receipt. */
  const writeState = {
    write: client.pair[0].write,
    failure: feedback.failure,
    failures: 0,
    errorCode: undefined as string | undefined
  }
  /** Reject the actual schema-error write; every other frame uses the original physical sender. */
  const observation = vi
    .spyOn(client.pair[0], 'write')
    .mockImplementation(async (frame, options) => {
      /** This existing identity medium delivers the original semantic frame without a second codec. */
      const message = frame.data as IRpcSemanticFrame
      if (message.kind === 'error' && message.task.method === 'test' && writeState.failures === 0) {
        writeState.errorCode = message.error.nodes[message.error.root]?.code
        writeState.failures += 1
        throw writeState.failure
      }
      /** Calling the captured arrow directly preserves the original physical receiver semantics. */
      const write = writeState.write
      await write(frame, options)
    })
  /** Lost error replies leave the real caller pending until its own public signal is cancelled. */
  const caller = new AbortController()
  /** This cleanup reason is not substituted for the original transport failure or validation. */
  const cleanupReason = new Error('original caller cleanup')
  /** Observe the original pending Promise immediately without inventing a terminal reply. */
  const pending = client.host.memory.request('test', 'invalid', { signal: caller.signal })
  /** Teardown joins the original call while preserving the unmodified Promise above. */
  const settled = pending.catch(() => undefined)
  try {
    /** This report is emitted by the actual failed physical reply, after real quota admission. */
    const reported = await feedback.reported.promise
    expect(reported).toMatchObject({ source: 'rpc.endpoint', code: RpcCoreErrorCode.transport })
    expect(walkErrorCauses(reported)).toContain(feedback.failure)
    expect(feedback.failure).toBeInstanceOf(Error)
    expect(feedback.failure.message).toBe('transport failed')
    expect(writeState.failures).toBe(1)
    expect(writeState.errorCode).toBe(RpcCoreErrorCode.schemaInvalid)
    expect(provider).not.toHaveBeenCalled()
    /** Success on this same accepted Session proves release before cleanup cancels its caller. */
    expect(await client.host.memory.request('test', 'next')).toBe('next')
    expect(provider).toHaveBeenCalledTimes(1)
    expect(client.pair[0].unsubscribed).toBe(0)
    caller.abort(cleanupReason)
    await settled
  } finally {
    caller.abort(cleanupReason)
    await settled
    observation.mockRestore()
    await client.host.close()
    await host.close()
  }
})
