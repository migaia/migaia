import { describe, expect, it, vi } from 'vitest'
import {
  WebRpcAuthenticationError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcSerializationError
} from '../../src/errors.js'
import { WebRpcOutboundSender } from '../../src/internal/outbound-sender.js'
import { WebRpcErrorText } from '../../src/error-text.js'
import type { IWebRpcAuthenticationTransform } from '../../src/typing.js'
import type { IWebRpcTransport } from '../../src/transport.js'
import { rpcProtocol, type IRpcEnvelope } from '@migaia/rpc-contract/v1'
import { bindRpcFrameIngress } from '@migaia/rpc-contract/framing'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
import type { IWebRpcSelectedComponents } from '../../src/internal/endpoint-options.js'

/** Builds the same selected component boundary production passes to the outbound sender. */
function selectedStringComponents(
  encode: (value: IRpcEnvelope) => string,
  decode: (value: unknown) => IRpcEnvelope = (value) => rpcProtocol.normalize(value),
  framer: IWebRpcSelectedComponents['framer'] = messageFramer
): IWebRpcSelectedComponents {
  return {
    protocol: rpcProtocol,
    codec: { id: 'test-string', version: 1, encodedType: 'string', encode, decode },
    framer,
    ingressPrepare: bindRpcFrameIngress(framer.accept, framer.frame),
    shadowed: []
  }
}

/** Creates a guarded test descriptor that proves sender behavior across selected physical frames. */
function selectedTwoFrameComponents(
  encode: (value: IRpcEnvelope) => string
): IWebRpcSelectedComponents {
  const framer: IWebRpcSelectedComponents['framer'] = {
    id: 'sender-test',
    version: 1,
    inputEncodedType: 'string',
    outputEncodedType: 'string',
    frame(value, context) {
      if (typeof value !== 'string')
        throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodedType('string'))
      const frame = messageFramer.frame(value, context)
      return [...frame, ...frame]
    },
    accept(frame, context) {
      return messageFramer.accept(frame, context)
    },
    close(reason) {
      messageFramer.close(reason)
    }
  }
  return selectedStringComponents(encode, undefined, framer)
}

/** Creates a selected descriptor whose physical framing failure remains visible to the sender. */
function selectedFailingFramerComponents(
  encode: (value: IRpcEnvelope) => string,
  failure: unknown
): IWebRpcSelectedComponents {
  const framer: IWebRpcSelectedComponents['framer'] = {
    id: 'sender-failing-test',
    version: 1,
    inputEncodedType: 'string',
    outputEncodedType: 'string',
    frame() {
      throw failure
    },
    accept(frame, context) {
      return messageFramer.accept(frame, context)
    },
    close(reason) {
      messageFramer.close(reason)
    }
  }
  return selectedStringComponents(encode, undefined, framer)
}

/** Produces a minimal canonical semantic message for framing-only sender tests. */
function canonicalRequest(id = 'task'): IRpcEnvelope {
  return rpcProtocol.normalize({
    kind: 'request',
    id,
    method: 'test',
    data: {
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      }
    }
  })
}

describe('outbound sender encoded type boundary', () => {
  it('preserves a semantic encode error before framing', () => {
    const admissionError = new WebRpcError(WebRpcErrorCode.overloaded, 'outbound capacity')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          throw new Error('send must not start')
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => {
        throw admissionError
      }),
      () => undefined
    )

    let thrown: unknown
    try {
      pipeline.send(canonicalRequest())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: WebRpcErrorCode.payloadInvalid, cause: admissionError })
  })

  it('prepares every authenticated selected frame before sending and retains first observed failure', async () => {
    let sends = 0
    let protectCalls = 0
    let rejectFirst: ((error: unknown) => void) | undefined
    let rejectSecond: ((error: unknown) => void) | undefined
    const firstAuthenticationError = new WebRpcAuthenticationError('first authentication failure')
    const secondAuthenticationError = new WebRpcAuthenticationError('second authentication failure')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedTwoFrameComponents(() => 'payload'),
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect: () => {
          protectCalls += 1
          return new Promise<never>((_, reject) => {
            if (protectCalls === 1) rejectFirst = reject
            else rejectSecond = reject
          })
        },
        unprotect: (value) => value
      }
    )

    const pending = pipeline.send(canonicalRequest())
    await vi.waitFor(() => expect(protectCalls).toBe(2))
    expect(sends).toBe(0)
    rejectSecond?.(secondAuthenticationError)
    await Promise.resolve()
    rejectFirst?.(firstAuthenticationError)

    await expect(pending).rejects.toBe(secondAuthenticationError)
    expect(sends).toBe(0)
  })

  it('keeps an authentication failure reachable through the sender boundary', async () => {
    const authenticationError = new WebRpcAuthenticationError('authentication failure')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          throw new Error('send must not start')
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'payload'),
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect: () => Promise.reject(authenticationError),
        unprotect: (value) => value
      }
    )

    const thrown = await Promise.resolve(pipeline.send(canonicalRequest())).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(thrown).toBe(authenticationError)
  })

  it.each([
    {
      label: 'throws synchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () => {
          throw cause
        }
    },
    {
      label: 'rejects asynchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () =>
          Promise.reject(cause)
    },
    {
      label: 'returns an invalid encoded value',
      createProtect: (): IWebRpcAuthenticationTransform => () => 42
    }
  ])(
    'H-T18 classifies unchunked authentication $label as AUTHENTICATION_FAILED',
    async ({ label, createProtect }) => {
      const cause = new Error(`authentication ${label}`)
      let sends = 0
      const pipeline = new WebRpcOutboundSender(
        {
          platform: 'Memory' as const,
          encodedType: 'string',
          send: () => {
            sends += 1
          },
          subscribe: () => () => undefined
        },
        'a',
        selectedStringComponents(() => 'payload'),
        () => undefined,
        {
          enabled: true,
          encodedType: 'string',
          protect: createProtect(cause),
          unprotect: (value) => value
        }
      )

      const thrown = await Promise.resolve(pipeline.send(canonicalRequest())).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      if (label !== 'returns an invalid encoded value')
        expect((thrown as { cause: unknown }).cause).toBe(cause)
      expect(sends).toBe(0)
    }
  )

  it.each([
    {
      label: 'throws synchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () => {
          throw cause
        }
    },
    {
      label: 'rejects asynchronously',
      createProtect:
        (cause: Error): IWebRpcAuthenticationTransform =>
        () =>
          Promise.reject(cause)
    },
    {
      label: 'returns an invalid encoded value',
      createProtect: (): IWebRpcAuthenticationTransform => () => 42
    }
  ])(
    'does not send framed messages when authentication $label',
    async ({ label, createProtect }) => {
      const cause = new Error(`frame authentication ${label}`)
      let sends = 0
      const pipeline = new WebRpcOutboundSender(
        {
          platform: 'Memory' as const,
          encodedType: 'string',
          send: () => {
            sends += 1
          },
          subscribe: () => () => undefined
        },
        'a',
        selectedStringComponents(() => 'payload'),
        () => undefined,
        {
          enabled: true,
          encodedType: 'string',
          protect: createProtect(cause),
          unprotect: (value) => value
        }
      )

      const thrown = await Promise.resolve(pipeline.send(canonicalRequest())).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      if (label !== 'returns an invalid encoded value')
        expect((thrown as { cause: unknown }).cause).toBe(cause)
      expect(sends).toBe(0)
    }
  )

  it('preserves a class transport receiver for ordinary and chunked sends', async () => {
    class PrivateTransport implements IWebRpcTransport {
      #sendCount = 0

      readonly platform = 'Memory' as const
      readonly encodedType = 'string' as const

      send(): void {
        this.#sendCount += 1
      }

      subscribe(): () => void {
        return () => undefined
      }

      get sendCount(): number {
        return this.#sendCount
      }
    }

    const transport = new PrivateTransport()
    const components = selectedStringComponents(() => 'payload')
    const pipeline = new WebRpcOutboundSender(transport, 'a', components, () => undefined)

    await pipeline.send(canonicalRequest())

    const secondPipeline = new WebRpcOutboundSender(
      transport,
      'a',
      selectedTwoFrameComponents(() => 'payload'),
      () => undefined
    )
    await secondPipeline.send(canonicalRequest('second-message'))

    expect(transport.sendCount).toBe(3)
  })

  it('snapshots transfer once and sends the owned list only on the unchunked frame', async () => {
    let transferReads = 0
    let transferLengthReads = 0
    const transfer = new Proxy([{}], {
      get(target, property, receiver) {
        if (property === 'length') transferLengthReads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    const sent: Array<{ value: unknown; transfer?: readonly unknown[] }> = []
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value, options) {
          sent.push({ value, transfer: options?.transfer })
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'payload'),
      () => undefined
    )
    const options = {
      get transfer() {
        transferReads += 1
        if (transferReads > 1) throw new Error('transfer reread')
        return transfer
      }
    }
    await pipeline.send(canonicalRequest(), options)
    expect(transferReads).toBe(1)
    expect(transferLengthReads).toBe(1)
    expect(sent[0]?.transfer).not.toBe(transfer)
    expect(sent[0]?.transfer).toEqual([transfer[0]])
    expect(Object.isFrozen(sent[0]?.transfer)).toBe(true)
  })

  it('keeps the owned transfer snapshot through caller mutation and exposes the physical failure cause', async () => {
    /** Represents the first caller-owned transferable preserved by the sender snapshot. */
    const firstTransferable = {}
    /** Represents the second caller-owned transferable preserved by the sender snapshot. */
    const secondTransferable = {}
    /** Represents a post-send caller mutation that must not alter the owned snapshot. */
    const laterTransferable = {}
    /** Holds caller-owned transfer state that becomes mutable after physical sending starts. */
    const callerTransfer = [firstTransferable, secondTransferable]
    /** Records the physical transport options after the outbound owner takes custody. */
    const sent: Array<{ value: unknown; transfer?: readonly unknown[] }> = []
    /** Is the exact physical rejection that must remain reachable as the wrapper cause. */
    const physicalFailure = new Error('physical send failed')
    /** Rejects the held physical send only after the caller mutation assertions run. */
    let rejectPhysicalSend: ((reason?: unknown) => void) | undefined
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value, options) {
          sent.push({ value, transfer: options?.transfer })
          return new Promise<void>((_resolve, reject) => {
            rejectPhysicalSend = reject
          })
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'payload'),
      () => undefined
    )

    /** Observes the outbound result across the held physical transport boundary. */
    const pending = Promise.resolve(pipeline.send(canonicalRequest(), { transfer: callerTransfer }))
    await vi.waitFor(() => expect(sent).toHaveLength(1))

    callerTransfer.splice(0, callerTransfer.length, laterTransferable)
    expect(sent[0]?.transfer).toEqual([firstTransferable, secondTransferable])
    expect(sent[0]?.transfer?.[0]).toBe(firstTransferable)
    expect(sent[0]?.transfer?.[1]).toBe(secondTransferable)
    expect(Object.isFrozen(sent[0]?.transfer)).toBe(true)

    rejectPhysicalSend?.(physicalFailure)
    /** Captures the normalized outbound rejection for code and cause identity assertions. */
    const failure = await pending.then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failure).toMatchObject({ code: WebRpcErrorCode.transport })
    expect((failure as { cause?: unknown }).cause).toBe(physicalFailure)
  })

  it('rejects a hostile transfer getter without sending', () => {
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'payload'),
      () => undefined
    )
    const options = Object.defineProperty({}, 'transfer', {
      get: () => {
        throw new Error('hostile transfer')
      }
    })
    expect(() => pipeline.send(canonicalRequest(), options)).toThrow(
      'Transfer list must be an array'
    )
    expect(sends).toBe(0)
  })

  it('reports one semantic encode failure before framing or transport send', async () => {
    let sends = 0
    const encodeError = new Error('frame encode failed')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
          return Promise.reject(new Error('send must not start'))
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => {
        throw encodeError
      }),
      () => undefined
    )

    expect(() => pipeline.send(canonicalRequest())).toThrow(WebRpcSerializationError)
    expect(sends).toBe(0)
  })

  it('protects variation frames through the authentication capability', async () => {
    let protectedValue: unknown
    let sentValue: unknown
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value) {
          sentValue = value
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'variation'),
      () => undefined,
      {
        enabled: true,
        encodedType: 'string',
        protect(value) {
          protectedValue = value
          return `${value}:protected`
        },
        unprotect: (value) => value
      }
    )

    await pipeline.sendVariation(canonicalRequest())
    expect(protectedValue).toBe('variation')
    expect(sentValue).toBe('variation:protected')
  })

  it('sends every physical frame selected by the canonical framer', async () => {
    const frames: unknown[] = []
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string' as const,
        send(value) {
          frames.push(value)
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'payload'),
      () => undefined
    )
    await pipeline.send(canonicalRequest())
    expect(frames).toHaveLength(1)
  })

  it('encodes once and sends every frame produced by the selected framer', async () => {
    let encodes = 0
    const sends: unknown[] = []
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send(value) {
          sends.push(value)
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedTwoFrameComponents(() => {
        encodes += 1
        return 'payload'
      }),
      () => undefined
    )
    await pipeline.send(canonicalRequest())
    expect(encodes).toBe(1)
    expect(sends).toHaveLength(2)
  })

  it('rejects a codec failure before send', () => {
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'any',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => {
        throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodedType('string'))
      }),
      () => undefined
    )
    expect(() => pipeline.send(canonicalRequest())).toThrow('Protocol encode failed')
    expect(sends).toBe(0)
  })
  it('normalizes a synchronous transport throw into a rejected promise', async () => {
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'any',
        send() {
          throw new Error('sync transport failure')
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => 'payload'),
      () => undefined
    )
    await expect(pipeline.send(canonicalRequest())).rejects.toMatchObject({
      code: 'TRANSPORT'
    })
  })
  it('reports transport failure when any selected frame send fails', async () => {
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => Promise.reject(new Error('frame send failed')),
        subscribe: () => () => undefined
      },
      'a',
      selectedTwoFrameComponents(() => 'payload'),
      () => undefined
    )
    await expect(pipeline.send(canonicalRequest())).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('HR-T01 waits for every selected frame send to settle before rejecting', async () => {
    let sendCount = 0
    let rejectFirst: ((error: unknown) => void) | undefined
    let resolveSecond: (() => void) | undefined
    const firstFailure = new Error('first frame failed')
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send: () => {
          sendCount += 1
          if (sendCount === 1)
            return new Promise<never>((_, reject) => {
              rejectFirst = reject
            })
          return new Promise<void>((resolve) => {
            resolveSecond = resolve
          })
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedTwoFrameComponents(() => 'payload'),
      () => undefined
    )

    const result = pipeline.send(canonicalRequest())
    const observed = Promise.resolve(result).catch((error: unknown) => error)
    let settled = false
    void observed.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(sendCount).toBe(2))

    rejectFirst?.(firstFailure)
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveSecond?.()
    await expect(observed).resolves.toMatchObject({
      code: 'TRANSPORT',
      cause: firstFailure
    })
  })

  it('HR-T02 retains a selected-framer failure as the primary sender cause', () => {
    const frameError = new Error('frame encode failed')
    let encodes = 0
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedFailingFramerComponents(() => {
        encodes += 1
        return 'payload'
      }, frameError),
      () => undefined
    )

    let thrown: unknown
    try {
      pipeline.send(canonicalRequest())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: WebRpcErrorCode.payloadInvalid, cause: frameError })
    expect(encodes).toBe(1)
    expect(sends).toBe(0)
  })

  it('does not send when the selected codec rejects before framing', () => {
    const failure = new Error('selected codec failed')
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedStringComponents(() => {
        throw failure
      }),
      () => undefined
    )
    expect(() => pipeline.send(canonicalRequest())).toThrow(WebRpcSerializationError)
    expect(sends).toBe(0)
  })
  it('does not send when a selected framer rejects', () => {
    const failure = new Error('selected framer failed')
    let sends = 0
    const pipeline = new WebRpcOutboundSender(
      {
        platform: 'Memory' as const,
        encodedType: 'string',
        send() {
          sends += 1
        },
        subscribe: () => () => undefined
      },
      'a',
      selectedFailingFramerComponents(() => 'payload', failure),
      () => undefined
    )
    let thrown: unknown
    try {
      pipeline.send(canonicalRequest())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: WebRpcErrorCode.payloadInvalid, cause: failure })
    expect(sends).toBe(0)
  })
})
