import { describe, expect, it, vi } from 'vitest'
import { WebRpcSchemaValidationError } from '../../src/errors'
import { ProviderExecutor } from '../../src/internal/provider-executor'
import { ProviderAdmissionRegistry } from '../../src/internal/provider-admission'
import { ProviderRegistry } from '../../src/internal/provider'
import type { IWebRpcContext, IWebRpcProvider } from '../../src/typing'
import type { IWebRpcRequest } from '../../src/wire'

const request: IWebRpcRequest = {
  kind: 'request',
  version: '1.0',
  taskId: 'task',
  senderId: 'peer',
  targetId: 'host',
  method: 'test',
  data: null,
  sentAt: Date.now()
}

function makeExecutor(result: unknown, sent: unknown[]): ProviderExecutor<string> {
  const registry = new ProviderRegistry()
  registry.register('test', () => result as never)
  return new ProviderExecutor<string>({
    id: 'host',
    registry,
    controllers: new Map(),
    admission: new ProviderAdmissionRegistry(),
    peers: [],
    dispatch: () => undefined,
    send: async (response) => {
      sent.push(response)
    },
    validate: () => undefined,
    emitFailure: () => undefined
  })
}

describe('ProviderExecutor result normalization', () => {
  it('rejects non-string failure metadata before sending it', async () => {
    const sent: unknown[] = []
    await makeExecutor({ ok: false, message: 42, code: 'BAD' }, sent).execute(request)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ ok: false }))
  })

  it('releases admission and identity when params validation fails', async () => {
    const admission = new ProviderAdmissionRegistry(1, 1)
    const releaseBinding = vi.fn()
    const sent: unknown[] = []
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry: new ProviderRegistry(),
      controllers: new Map(),
      admission,
      peers: [],
      dispatch: () => undefined,
      send: async (response) => {
        sent.push(response)
      },
      validate: () => {
        throw new WebRpcSchemaValidationError('invalid params', { field: 'data' })
      },
      emitFailure: () => undefined,
      retainBinding: () => true,
      releaseBinding
    })
    await executor.execute(request, 'verified-peer')
    expect(releaseBinding).toHaveBeenCalledOnce()
    expect(admission.acquire('next', 'verified-peer')).toBe(true)
    expect(sent).toEqual([
      expect.objectContaining({ ok: false, code: 'SCHEMA_INVALID', data: { field: 'data' } })
    ])
  })

  it('releases admission even when validation failure response cannot be sent', async () => {
    const admission = new ProviderAdmissionRegistry(1, 1)
    const releaseBinding = vi.fn()
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry: new ProviderRegistry(),
      controllers: new Map(),
      admission,
      peers: [],
      dispatch: () => undefined,
      send: async () => {
        throw new Error('transport failed')
      },
      validate: () => {
        throw new Error('invalid params')
      },
      emitFailure: () => undefined,
      retainBinding: () => true,
      releaseBinding
    })
    await expect(executor.execute(request, 'verified-peer')).rejects.toThrow('transport failed')
    expect(releaseBinding).toHaveBeenCalledOnce()
    expect(admission.acquire('next', 'verified-peer')).toBe(true)
  })

  it('does not execute or retain an expired verified binding', async () => {
    const admission = new ProviderAdmissionRegistry(1, 1)
    const provider = vi.fn()
    const registry = new ProviderRegistry()
    registry.register('test', provider)
    const sent: unknown[] = []
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission,
      peers: [],
      dispatch: () => undefined,
      send: async (response) => {
        sent.push(response)
      },
      validate: () => undefined,
      emitFailure: () => undefined,
      retainBinding: () => false
    })
    await executor.execute(request, 'expired-peer')
    expect(provider).not.toHaveBeenCalled()
    expect(sent).toEqual([expect.objectContaining({ ok: false, code: 'OVERLOADED' })])
    expect(admission.acquire('next', 'expired-peer')).toBe(true)
  })

  it('rejects oversized transfer metadata without sending a transfer list', async () => {
    const sent: unknown[] = []
    await makeExecutor(
      { ok: true, data: 'ok', transfer: Array.from({ length: 65 }, () => ({})) },
      sent
    ).execute(request)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ ok: false }))
  })

  it('sends branded success data and a frozen transfer snapshot', async () => {
    const sent: Array<{ response: unknown; transfer?: readonly unknown[] }> = []
    const transfer = {}
    const registry = new ProviderRegistry()
    registry.register('test', (context) => context.success('ok', { transfer: [transfer] }))
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send: async (response, responseTransfer) => {
        sent.push({ response, transfer: responseTransfer })
      },
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute({ ...request, receiverId: 'receiver-1' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.response).toEqual(
      expect.objectContaining({ ok: true, data: 'ok', receiverId: 'receiver-1' })
    )
    expect(sent[0]?.transfer).toEqual([transfer])
    expect(Object.isFrozen(sent[0]?.transfer)).toBe(true)
  })

  it('sends branded provider failures without exposing params', async () => {
    const sent: unknown[] = []
    const registry = new ProviderRegistry()
    registry.register('test', (context) => context.failed('denied', 'DENIED'))
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send: async (response) => {
        sent.push(response)
      },
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute(request)
    expect(sent).toEqual([
      expect.objectContaining({ ok: false, message: 'denied', code: 'DENIED' })
    ])
  })

  it('dispatches events to an explicit peer or every peer except the sender', async () => {
    const dispatched: unknown[] = []
    const registry = new ProviderRegistry()
    registry.register('test', (context) => {
      context.dispatchTo({ id: 'chosen', method: 'event.one', data: 1 })
      context.dispatchTo({ method: 'event.all', data: 2 })
      return context.success()
    })
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: ['peer', 'other'],
      dispatch: (targetId, method, data) => dispatched.push({ targetId, method, data }),
      send: async () => undefined,
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute(request)
    expect(dispatched).toEqual([
      { targetId: 'chosen', method: 'event.one', data: 1 },
      { targetId: 'other', method: 'event.all', data: 2 }
    ])
  })

  it('executes dispatch listeners serially without sending a response', async () => {
    const calls: string[] = []
    const registry = new ProviderRegistry()
    registry.listen('test', async () => {
      await Promise.resolve()
      calls.push('first')
    })
    registry.listen('test', () => {
      calls.push('second')
    })
    const send = vi.fn()
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send,
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute({ ...request, dispatchOnly: true })
    expect(calls).toEqual(['first', 'second'])
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects replay and admission overflow before provider execution', async () => {
    const provider = vi.fn()
    const registry = new ProviderRegistry()
    registry.register('test', provider)
    const replaySend = vi.fn()
    const replayExecutor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send: replaySend,
      validate: () => undefined,
      emitFailure: () => undefined,
      isReplay: () => true
    })
    await replayExecutor.execute(request)
    expect(provider).not.toHaveBeenCalled()
    expect(replaySend).not.toHaveBeenCalled()

    const overflowSend = vi.fn()
    const overflowExecutor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send: overflowSend,
      validate: () => undefined,
      emitFailure: () => undefined,
      admitReplay: () => false
    })
    await overflowExecutor.execute(request)
    expect(provider).not.toHaveBeenCalled()
    expect(overflowSend).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'OVERLOADED' })
    )
  })

  it('returns a stable failure when no provider owns the method', async () => {
    const send = vi.fn(async () => undefined)
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry: new ProviderRegistry(),
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send,
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute(request)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'PROVIDER_NOT_FOUND' })
    )
  })

  it('maps provider schema exceptions and invalid dispatch ids without leaking controllers', async () => {
    const cases: IWebRpcProvider[] = [
      () => {
        throw new WebRpcSchemaValidationError('result invalid', { result: true })
      },
      (context: IWebRpcContext) => {
        context.dispatchTo({ id: '', method: 'event', data: null })
        return context.success()
      }
    ]
    for (const provider of cases) {
      const registry = new ProviderRegistry()
      registry.register('test', provider)
      const controllers = new Map<string, AbortController>()
      const sent: unknown[] = []
      const failures: Array<{ error: unknown; code: string }> = []
      const executor = new ProviderExecutor<string>({
        id: 'host',
        registry,
        controllers,
        admission: new ProviderAdmissionRegistry(),
        peers: [],
        dispatch: () => undefined,
        send: async (response) => {
          sent.push(response)
        },
        validate: () => undefined,
        emitFailure: (error, code) => failures.push({ error, code })
      })
      await executor.execute(request)
      expect(sent).toHaveLength(1)
      if (provider === cases[0]) {
        expect(sent[0]).toEqual(
          expect.objectContaining({
            ok: false,
            code: 'SCHEMA_INVALID',
            serializedError: expect.objectContaining({
              name: 'WebRpcSchemaValidationError',
              code: 'SCHEMA_INVALID',
              data: { result: true }
            })
          })
        )
      } else {
        expect(sent[0]).toEqual(
          expect.objectContaining({
            serializedError: expect.objectContaining({
              name: 'WebRpcContractError',
              code: 'CONTRACT_INVALID'
            })
          })
        )
      }
      expect(failures).toHaveLength(1)
      expect(controllers.size).toBe(0)
    }
  })

  it('honors a pending abort before provider settlement and sends no late response', async () => {
    const registry = new ProviderRegistry()
    let signalAborted = false
    registry.register('test', (context) => {
      signalAborted = context.signal.aborted
      return context.success('too-late')
    })
    const send = vi.fn(async () => undefined)
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send,
      validate: () => undefined,
      emitFailure: () => undefined,
      consumePendingAbort: () => true
    })
    await executor.execute(request, 'verified-peer')
    expect(signalAborted).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('executes dispatch-only providers without emitting responses', async () => {
    const provider = vi.fn((context: IWebRpcContext) => context.success('ignored'))
    const registry = new ProviderRegistry()
    registry.register('test', provider)
    const send = vi.fn(async () => undefined)
    const executor = new ProviderExecutor<string>({
      id: 'host',
      registry,
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch: () => undefined,
      send,
      validate: () => undefined,
      emitFailure: () => undefined
    })
    await executor.execute({ ...request, dispatchOnly: true })
    expect(provider).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })
})
