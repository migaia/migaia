/** Original provider ingress assertions use accepted Sessions and their actual physical writes. */
import { createRpcHost } from '@migaia/rpc-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcWireError, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { deferred } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

// Only the old response DTO spelling/correlation allocation is .
it('accepted provider ingress checks receiver identity before a second execution', async () => {
  /** Only the original echo business changes this count; the barrier has no echo side effect. */
  let executions = 0
  /** Preserve the original accepted server and caller identities through actual handshakes. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** Both providers are published by the real public registration owner. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      echo: (value, context) => {
        executions += 1
        return context.success(value)
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** The original peer's two endpoints belong to the existing native fixture. */
  const client = await server.connect('r70-client')
  try {
    await client.host.memory.send('provider-admission-fixture', 'echo', 'r70-data')
    expect(executions).toBe(1)
    /** Reuse the genuinely allocated task and generations rather than inventing admission facts. */
    const admitted = client.pair[1].written.find((frame) => frame.kind === 'call')
    assert(admitted?.kind === 'call')
    expect(client.pair[0].written).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        id: admitted.id,
        route: expect.objectContaining({ targetId: 'r70-client' }),
        result: 'r70-data'
      })
    )
    /** Only receiverId is forged; the original admitted sender and exact task remain unchanged. */
    await client.pair[1].write({
      kind: 'message',
      data: {
        ...admitted,
        id: 'forged-receiver',
        route: { ...admitted.route, receiverId: 'wrong-receiver' }
      }
    })
    /** This real reply follows the hostile input through the same original receiver chain. */
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'after-forgery')
    expect(executions).toBe(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// Notify replaces the removed v1 dispatchOnly route field.
it('accepted notify executes once without any correlated physical terminal', async () => {
  /** The original echo execution, not a physical-write counter, proves notification delivery. */
  let executions = 0
  /** Actual provider completion is observed before the subsequent real barrier request. */
  const completed = deferred<void>()
  /** This listener admits the original caller through the same canonical Session path. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** Notify and barrier share the genuine provider catalog and accepted input chain. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      echo: (_value, context) => {
        executions += 1
        completed.resolve()
        return context.success('dispatch')
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** Handshake traffic belongs to the actual connection and is not a notify reply. */
  const client = await server.connect('r70-client')
  try {
    await client.host.memory.notify('echo', 'r70-data')
    await completed.promise
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'after-notify')
    expect(executions).toBe(1)
    /** Correlation comes from the original admitted notify, never a fabricated request receipt. */
    const notification = client.pair[1].written.find(
      (frame) => frame.kind === 'call' && frame.task.mode === 'notify'
    )
    assert(notification?.kind === 'call')
    /** Exclude real handshake/barrier traffic while retaining every frame for this notify id. */
    const messages = client.pair[0].written.filter(
      (frame) => 'id' in frame && frame.id === notification.id
    )
    expect(messages).toEqual([])
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// The actual server, not the caller's directory, rejects this method.
it('accepted physical ingress returns the original missing-provider error code', async () => {
  /** The real error write completes this observation without polling or synthetic endpoint replies. */
  const terminal = deferred<Extract<IRpcSemanticFrame, { kind: 'error' }>>()
  /** Keep the original provider present while the forged method alone is absent. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** A real successful request supplies the source-admitted task metadata for the absent method. */
  const host = await createRpcHost({
    ...server.options,
    provide: { echo: (_value, context) => context.success('present') }
  })
  /** Both actual endpoints are ready before physical server-response observation is installed. */
  const client = await server.connect('r70-client')
  /** This stable arrow is the original actual write, including its real receiver delivery. */
  const write = client.pair[0].write
  /** Observe only the correlated original server write; no codec/parser or reply owner is added. */
  const observation = vi
    .spyOn(client.pair[0], 'write')
    .mockImplementation(async (frame, options) => {
      await write(frame, options)
      /** The existing identity medium writes semantic metadata directly. */
      const message = frame.data as IRpcSemanticFrame
      if (message.kind === 'error' && message.id === 'not-found') terminal.resolve(message)
    })
  try {
    await client.host.memory.send('provider-admission-fixture', 'echo')
    /** Copy only this actual call's admitted sender/task generations into the hostile method input. */
    const admitted = client.pair[1].written.find((frame) => frame.kind === 'call')
    assert(admitted?.kind === 'call')
    await client.pair[1].write({
      kind: 'message',
      data: {
        ...admitted,
        id: 'not-found',
        task: { ...admitted.task, method: 'missing' }
      }
    })
    /** The canonical flat error graph carries the original semantic not-found code. */
    const response = await terminal.promise
    expect(deserializeRpcWireError(response.error)).toMatchObject({
      code: RpcCoreErrorCode.providerNotFound
    })
  } finally {
    observation.mockRestore()
    await Promise.all([client.host.close(), host.close()])
  }
})
