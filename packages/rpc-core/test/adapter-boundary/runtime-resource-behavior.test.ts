import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import * as promiseTools from '@migaia/utils/promise'
import { RpcCapability } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import {
  createEventEmitterMessageResource,
  createEventTargetMessageResource,
  type IAdapterEventEmitterMessagePort,
  type IAdapterLaunchHandle
} from '../../dist/adapter.js'
import { readAdapterMessagePreparation } from '../../dist/runtime-adapter/message/resource.js'
import {
  createMessageReceiveHandoff,
  createEventTargetMessageHandoff
} from '../../dist/runtime-adapter/message/handoff.js'

/** Reuse real EventEmitter subscription semantics while observing only held raw port operations. */
function messaging() {
  /** Physical callbacks arrive synchronously through this original native event owner. */
  const events = new EventEmitter()
  /** ACK writes are ordinary observed output, never accepted agreement inputs. */
  const postMessage = vi.fn((_message: unknown, _transfer?: readonly unknown[]) => undefined)
  /** This supported structural port deliberately omits optional native reader-count operations. */
  const port: IAdapterEventEmitterMessagePort = {
    postMessage,
    on: (event, listener) => {
      events.on(event, listener)
    },
    off: (event, listener) => {
      events.off(event, listener)
    }
  }
  return { events, postMessage, port }
}

/** Initial data is raw received control; only the actual resource parser admits its parent address. */
function initial() {
  return {
    kind: rpcMessageCapabilityControl.data,
    peerId: 'child-1',
    runtimeApi: {
      version: rpcMessageCapabilityControl.version,
      self: { name: 'child', instanceId: 'child-1' },
      parent: { name: 'parent', instanceId: 'parent-1' },
      capabilities: [RpcCapability.stream, RpcCapability.batch]
    }
  }
}

/** Retain an unfinished launch so individual cases can deliver actual exit/failure outcomes. */
function launch() {
  /** The test controls actual completion independently from requesting termination. */
  const exited = promiseTools.deferred<unknown>()
  /** The launcher can report an original failure independently from its later exit completion. */
  const failed = promiseTools.deferred<unknown>()
  /** Termination is requested once while actual native completion remains independently owned. */
  const terminate = vi.fn()
  /** Core consumes these ordinary launcher-owned operations rather than caller qualification flags. */
  const handle: IAdapterLaunchHandle = { exited: exited.promise, failed: failed.promise, terminate }
  return { handle, exited, failed, terminate }
}

describe('runtime message resource control and cleanup', () => {
  it.each(['outbound', 'malformed'] as const)(
    '[HC1] rejects %s initial input without installing a receiver',
    async (kind) => {
      /** Initial admission precedes cold subscription and any capability write. */
      const physical = messaging()
      /**
       * Only this Core-created held resource owns capture, control admission and channel
       * retirement.
       */
      const resource = createEventEmitterMessageResource(physical.port)
      expect(() =>
        resource.receiveInitial({
          direction: kind === 'outbound' ? 'outbound' : 'inbound',
          read: () => (kind === 'malformed' ? {} : initial())
        })
      ).toThrow(expect.objectContaining({ source: '@migaia/rpc/core', code: 'INVALID_CONFIG' }))
      expect(physical.events.listenerCount('message')).toBe(0)
      expect(physical.postMessage).not.toHaveBeenCalled()
      await resource.close()
    }
  )

  it('[HC2] captures a genuine initial message once and retains control/open/close Promise identity', async () => {
    /** A received bootstrap creates the existing principal association through actual admission. */
    const physical = messaging()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port)
    /** The actual received initial record is admitted once and retained without caller substitution. */
    const raw = initial()
    /** The original initial-read Promise retains admission result and native failure identity. */
    const receiving = resource.receiveInitial({ direction: 'inbound', read: () => raw })
    expect(resource.receiveInitial({ direction: 'inbound', read: () => raw })).toBe(receiving)
    await expect(receiving).resolves.toBe(raw)
    /** Repeated preparation consumes the same raw initial and emits only one local ACK. */
    const controlled = resource.prepareControl([RpcCapability.batch], {
      direction: 'inbound',
      read: () => raw
    })
    expect(resource.prepareControl([RpcCapability.batch])).toBe(controlled)
    await expect(controlled).resolves.toEqual([RpcCapability.batch])
    expect(physical.postMessage).toHaveBeenCalledExactlyOnceWith(
      rpcMessageCapabilityControl.acknowledgement([RpcCapability.batch]),
      undefined
    )
    /** Local configuration supplies source policy without asserting accepted resource provenance. */
    const options = {
      peerId: 'parent-1',
      scheduler: createManualScheduler(),
      offer: [RpcCapability.batch],
      control: rpcMessageCapabilityControl
    }
    /** Expanded opening joins one startup attempt rather than installing another ACK receiver. */
    const opening = resource.open(options)
    expect(resource.open(options)).toBe(opening)
    /**
     * This exact channel comes from admitted raw control and retains its physical resource
     * identity.
     */
    const channel = await opening
    expect(channel.agreement.capabilities).toEqual([RpcCapability.batch])
    /** Retirement must preserve the original owner Promise rather than allocate another close. */
    const closing = resource.close()
    expect(resource.close()).toBe(closing)
    await closing
    expect(physical.events.listenerCount('message')).toBe(0)
  })

  it('[HC3] refuses ordinary traffic while waiting for initial control and removes cold hooks', async () => {
    /** Raw event operations observe startup output and listener cleanup on the original port. */
    const physical = messaging()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port)
    /** The original initial-read Promise retains admission result and native failure identity. */
    const receiving = resource.receiveInitial()
    physical.events.emit('message', { business: true })
    await expect(receiving).rejects.toBeInstanceOf(TypeError)
    await expect(receiving).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      cause: expect.objectContaining({ detail: { field: 'bootstrap' } })
    })
    expect(physical.events.listenerCount('message')).toBe(0)
    expect(physical.events.listenerCount('messageerror')).toBe(0)
    await resource.close()
  })

  it('[HC4] consumes actual initial control received by a waiting resource', async () => {
    /** Raw event operations observe startup output and listener cleanup on the original port. */
    const physical = messaging()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port)
    /** The actual received initial record is admitted once and retained without caller substitution. */
    const raw = initial()
    /** The original initial-read Promise retains admission result and native failure identity. */
    const receiving = resource.receiveInitial()
    physical.events.emit('message', raw)
    await expect(receiving).resolves.toBe(raw)
    expect(readAdapterMessagePreparation(resource)?.initial?.parent.instanceId).toBe('parent-1')
    await resource.close()
  })

  it('[HC5] ignores readiness control but rejects a duplicate ACK with the original native cause', async () => {
    /** Raw event operations observe startup output and listener cleanup on the original port. */
    const physical = messaging()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port)
    /** Concurrent preparation consumers must join this original endpoint construction Promise. */
    const preparing = resource.prepareControl([RpcCapability.batch])
    physical.events.emit('message', { kind: rpcMessageCapabilityControl.ready })
    physical.events.emit(
      'message',
      rpcMessageCapabilityControl.acknowledgement([RpcCapability.batch])
    )
    physical.events.emit(
      'message',
      rpcMessageCapabilityControl.acknowledgement([RpcCapability.batch])
    )
    await expect(preparing).resolves.toEqual([RpcCapability.batch])
    await expect(readAdapterMessagePreparation(resource)!.readyBootstrap).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      cause: expect.objectContaining({ detail: { field: 'runtimeApi.ack' } })
    })
    expect(physical.events.listenerCount('message')).toBe(0)
    await resource.close()
  })

  it.each(['static', 'prepare', 'open', 'descriptor'] as const)(
    '[HC6] rejects invalid %s capability configuration before physical output',
    async (kind) => {
      /** Raw event operations observe startup output and listener cleanup on the original port. */
      const physical = messaging()
      /**
       * Only this Core-created held resource owns capture, control admission and channel
       * retirement.
       */
      const resource = createEventEmitterMessageResource(physical.port)
      /** Monotonic fixture time belongs to the existing resource deadlines and idle policy. */
      const scheduler = createManualScheduler()
      if (kind === 'static')
        expect(() =>
          resource.openStatic({ peerId: 'peer', scheduler, enabled: [RpcCapability.transfer] })
        ).toThrow(TypeError)
      else if (kind === 'prepare')
        expect(() => resource.prepareControl(['duplicated', 'duplicated'])).toThrow(TypeError)
      else
        await expect(
          resource.open({
            peerId: 'peer',
            scheduler,
            offer: kind === 'open' ? ['duplicated', 'duplicated'] : [],
            control:
              kind === 'descriptor'
                ? { ...rpcMessageCapabilityControl }
                : rpcMessageCapabilityControl
          })
        ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      expect(physical.postMessage).not.toHaveBeenCalled()
      expect(physical.events.listenerCount('message')).toBe(0)
      await resource.close()
    }
  )

  it('[HC7] preserves an already aborted opening reason without sending control', async () => {
    /** Raw event operations observe startup output and listener cleanup on the original port. */
    const physical = messaging()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port)
    /** The original abort source owns cancellation before or during control preparation. */
    const controller = new AbortController()
    /** Cancellation must retain this exact original reason through startup rejection. */
    const reason = { cancelled: true }
    controller.abort(reason)
    await expect(
      resource.open({
        peerId: 'peer',
        scheduler: createManualScheduler(),
        offer: [],
        control: rpcMessageCapabilityControl,
        signal: controller.signal
      })
    ).rejects.toBe(reason)
    expect(physical.postMessage).not.toHaveBeenCalled()
    await resource.close()
  })

  it('[HC8] removes the active abort listener and terminates its held launch exactly once', async () => {
    /** Raw event operations observe startup output and listener cleanup on the original port. */
    const physical = messaging()
    /** Actual launch completion and termination stay on this one held launcher resource. */
    const native = launch()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port, native.handle)
    /** The original abort source owns cancellation before or during control preparation. */
    const controller = new AbortController()
    /** Observe removal of the original native subscription rather than a replacement callback. */
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    /** Cancellation must retain this exact original reason through startup rejection. */
    const reason = { cancelled: 'during-control' }
    /** Expanded opening joins one startup attempt rather than installing another ACK receiver. */
    const opening = resource.open({
      peerId: 'peer',
      scheduler: createManualScheduler(),
      offer: [],
      control: rpcMessageCapabilityControl,
      signal: controller.signal
    })
    controller.abort(reason)
    await expect(opening).rejects.toBe(reason)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(native.terminate).toHaveBeenCalledOnce()
    expect(physical.events.listenerCount('message')).toBe(0)
    await resource.close()
    expect(native.terminate).toHaveBeenCalledOnce()
  })

  it('[HC9] uses an outbound launch proposal without echoing an ACK', async () => {
    /** Raw event operations observe startup output and listener cleanup on the original port. */
    const physical = messaging()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventEmitterMessageResource(physical.port)
    /** Concurrent preparation consumers must join this original endpoint construction Promise. */
    const preparing = resource.prepareControl([RpcCapability.batch], {
      direction: 'outbound',
      read: () => initial()
    })
    expect(physical.postMessage).not.toHaveBeenCalled()
    physical.events.emit(
      'message',
      rpcMessageCapabilityControl.acknowledgement([RpcCapability.batch])
    )
    await expect(preparing).resolves.toEqual([RpcCapability.batch])
    await resource.close()
  })

  it.each(['exit', 'exitRejection', 'failure', 'failureRejection'] as const)(
    '[HC10] reports early %s through startup failure and requests one termination',
    async (kind) => {
      /** Raw event operations observe startup output and listener cleanup on the original port. */
      const physical = messaging()
      /** Actual launch completion and termination stay on this one held launcher resource. */
      const native = launch()
      /**
       * Only this Core-created held resource owns capture, control admission and channel
       * retirement.
       */
      const resource = createEventEmitterMessageResource(physical.port, native.handle)
      /** The original native cause remains reachable through the startup failure object. */
      const cause = { native: kind }
      if (kind === 'exit') native.exited.resolve({ error: cause })
      else if (kind === 'exitRejection') native.exited.reject(cause)
      else if (kind === 'failure') native.failed.resolve(cause)
      else native.failed.reject(cause)
      await expect(readAdapterMessagePreparation(resource)!.readyBootstrap).rejects.toMatchObject({
        code: 'INVALID_CONFIG',
        cause
      })
      await expect(resource.prepareControl([])).rejects.toMatchObject({
        code: 'INVALID_CONFIG',
        cause
      })
      expect(native.terminate).toHaveBeenCalledOnce()
      expect(physical.events.listenerCount('message')).toBe(0)
      await resource.close()
    }
  )

  it('[HC11] constructs an EventTarget borrowed static channel and closes it without native termination', async () => {
    /** The original raw event owner exposes subscription retirement without another message queue. */
    const events = new EventEmitter()
    /** Observe resource retirement separately from facade construction and ownership selection. */
    const close = vi.fn()
    /** Only this Core-created held resource owns capture, control admission and channel retirement. */
    const resource = createEventTargetMessageResource({
      postMessage: vi.fn(),
      addEventListener: (event, listener) => {
        events.on(event, listener)
      },
      removeEventListener: (event, listener) => {
        events.off(event, listener)
      },
      close
    } as Parameters<typeof createEventTargetMessageResource>[0])
    /**
     * This exact channel comes from admitted raw control and retains its physical resource
     * identity.
     */
    const channel = resource.openStatic({
      peerId: 'peer',
      scheduler: createManualScheduler(),
      enabled: []
    })
    expect(channel.agreement.capabilities).toEqual([])
    await resource.close()
    expect(close).not.toHaveBeenCalled()
    expect(events.listenerCount('message')).toBe(0)
  })
})

describe('message receive handoff errors and subscription cleanup', () => {
  it('[HC12] removes a synchronous failure registration and retains its cause for activation', () => {
    /** The original native cause remains reachable through the startup failure object. */
    const cause = { failed: 'during-subscribe' }
    /** The native failure registration supplies the remover even when it fails synchronously. */
    const removeFailure = vi.fn()
    /** Retain the original failure for cause, reporting and subscriber-cleanup assertions. */
    const failure = vi.fn()
    /** Observe which exact callback the cold capture owner installs on native message input. */
    const add = vi.fn()
    /** Observe removal of the original native subscription rather than a replacement callback. */
    const remove = vi.fn()
    /**
     * This sole cold receiver retains one frame and transfers the original subscription on
     * activation.
     */
    const handoff = createMessageReceiveHandoff(
      {
        add,
        remove,
        /** Native failure may arrive before subscription returns its cleanup operation. */
        observeFailure: (fail) => {
          fail(cause)
          return removeFailure
        }
      },
      { onFailure: failure }
    )
    expect(removeFailure).toHaveBeenCalledOnce()
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cause, code: 'INVALID_CONFIG' })
    )
    expect(() => handoff.activateReceive()).toThrow(failure.mock.calls[0]![0])
    expect(remove).toHaveBeenCalledWith(add.mock.calls[0]![0])
    handoff.close()
  })

  it('[HC13] unsubscribes the cold receiver and transfers later subscriptions without redelivery', () => {
    /** The original raw event owner exposes subscription retirement without another message queue. */
    const events = new EventEmitter()
    /**
     * This sole cold receiver retains one frame and transfers the original subscription on
     * activation.
     */
    const handoff = createMessageReceiveHandoff<unknown>({
      add: (listener) => {
        events.on('message', listener)
      },
      remove: (listener) => {
        events.off('message', listener)
      },
      observeFailure: () => () => undefined
    })
    /** The first cold receiver must receive no buffered or live frames after unsubscribe. */
    const first = vi.fn()
    /** The active receiver handles later native input after the cold subscription is removed. */
    const second = vi.fn()
    handoff.subscribe(first)
    handoff.unsubscribe(first)
    events.emit('message', 'buffered')
    handoff.activateReceive()
    expect(first).not.toHaveBeenCalled()
    handoff.subscribe(second)
    events.emit('message', 'live')
    expect(second).toHaveBeenCalledExactlyOnceWith('live')
    handoff.unsubscribe(second)
    events.emit('message', 'ignored')
    handoff.activateReceive()
    expect(second).toHaveBeenCalledOnce()
    handoff.close()
    expect(events.listenerCount('message')).toBe(0)
  })

  it('[HC14] delegates a failure reporter exception without replacing the retained startup error', () => {
    /** A reporter exception is secondary and must not replace the retained startup failure. */
    const reporterFailure = { report: 'failed' }
    /**
     * Observe delegation of reporter failure to the existing host reporter without process
     * termination.
     */
    const rethrow = vi
      .spyOn(promiseTools, 'hostRethrowReporter')
      .mockImplementation(() => undefined)
    /**
     * This sole cold receiver retains one frame and transfers the original subscription on
     * activation.
     */
    const handoff = createMessageReceiveHandoff(
      { add: () => undefined, remove: () => undefined, observeFailure: () => () => undefined },
      {
        /** Reporter exceptions remain secondary to the failure already retained by the handoff. */
        onFailure: () => {
          throw reporterFailure
        }
      }
    )
    try {
      handoff.fail('native-cause')
      expect(rethrow).toHaveBeenCalledWith(reporterFailure, expect.anything())
      expect(() => handoff.activateReceive()).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG', cause: 'native-cause' })
      )
    } finally {
      handoff.close()
      rethrow.mockRestore()
    }
  })

  it.each([undefined, 42, {}, { error: undefined }, { error: null }, { error: 'native-error' }])(
    '[HC15] preserves EventTarget failure cause for %j and removes original listeners',
    (event) => {
      /** The original raw event owner exposes subscription retirement without another message queue. */
      const events = new EventEmitter()
      /** Retain the original failure for cause, reporting and subscriber-cleanup assertions. */
      const failure = vi.fn()
      /**
       * This sole cold receiver retains one frame and transfers the original subscription on
       * activation.
       */
      const handoff = createEventTargetMessageHandoff(
        {
          postMessage: () => undefined,
          addEventListener: (type, listener) => {
            events.on(type, listener)
          },
          removeEventListener: (type, listener) => {
            events.off(type, listener)
          }
        },
        { onFailure: failure }
      )
      events.emit('error', event)
      expect(failure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          code: 'INVALID_CONFIG',
          cause:
            event && typeof event === 'object' && 'error' in event ? (event.error ?? event) : event
        })
      )
      expect(events.listenerCount('error')).toBe(0)
      expect(events.listenerCount('messageerror')).toBe(0)
      expect(() => handoff.activateReceive()).toThrow(failure.mock.calls[0]![0])
      handoff.close()
    }
  )
})
