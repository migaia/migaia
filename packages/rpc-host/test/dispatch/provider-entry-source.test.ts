/** Original provider entry assertions run through the public namespace and physical carrier. */
import { createRpcHost } from '@migaia/rpc-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { assert, expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

it('real transaction baseline: provider RPC executes through its public namespace', async () => {
  /** The genuine native listener preserves the original provider target name. */
  const server = coreMemoryServer('provider-exposure-host')
  /** Provider registration uses the actual public dispatcher and its successful value path. */
  const host = await createRpcHost({
    ...server.options,
    provide: { echo: (value, context) => context.success(value) }
  })
  /** This original native connection completes both canonical Session handshakes. */
  const client = await server.connect('provider-client')
  try {
    await expect(client.host.memory.send('provider-exposure-host', 'echo', 'ok')).resolves.toBe(
      'ok'
    )
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('real provider security baseline rejects a forged receiver without execution', async () => {
  /** Only actual invocation of the original echo provider changes this business observation. */
  let executions = 0
  /** The same native listener admits the legitimate caller before hostile physical input. */
  const server = coreMemoryServer('provider-security-host')
  /** A genuine barrier call supplies an admitted frame and later proves sequential receipt. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      barrier: (value, context) => context.success(value),
      echo: (value, context) => {
        executions += 1
        return context.success(value)
      }
    }
  })
  /** Both physical endpoints belong to the existing native transport fixture. */
  const client = await server.connect('provider-client')
  try {
    await client.host.memory.send('provider-security-host', 'barrier', 'before-forgery')
    /** Borrow actual generated task/generation metadata rather than fabricating accepted authority. */
    const admitted = client.pair[1].written.find((frame) => frame.kind === 'call')
    assert(admitted?.kind === 'call')
    /** The original hostile sender/receiver reach the actual physical input and canonical codec. */
    await client.pair[1].write({
      kind: 'message',
      data: {
        ...admitted,
        id: 'forged-task',
        route: {
          ...admitted.route,
          senderId: 'forged-sender',
          receiverId: 'wrong-receiver'
        },
        task: { ...admitted.task, method: 'echo' },
        payload: 'forged'
      }
    })
    /** Session's existing input chain reaches this real reply after rejecting the earlier route. */
    await client.host.memory.send('provider-security-host', 'barrier', 'after-forgery')
    expect(executions).toBe(0)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('real provider response baseline preserves native provider error code and cause chain', async () => {
  /** Preserve the exact original native cause and the provider's original primary error. */
  const cause = new TypeError('provider failure cause')
  /** The real dispatcher receives this original Error, without a test-side wrapper or projection. */
  const primary = new Error('provider failure', { cause })
  /** The original provider target is published by the actual native transport installation. */
  const server = coreMemoryServer('provider-error-host')
  /** Public provider registration throws the original error at its actual business boundary. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      fail: () => {
        throw primary
      }
    }
  })
  /** The original caller identity now reaches the provider through its genuine namespace. */
  const client = await server.connect('provider-error-client')
  try {
    await expect(
      client.host.memory.send('provider-error-host', 'fail', null)
    ).rejects.toMatchObject({
      /** The code is attached to the provider's own error rather than a wrapper. */
      code: RpcCoreErrorCode.internal,
      message: primary.message,
      stack: primary.stack,
      cause: expect.objectContaining({
        name: 'TypeError',
        message: cause.message,
        stack: cause.stack
      })
    })
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})
