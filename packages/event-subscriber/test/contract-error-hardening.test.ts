/** Event-subscriber error and terminal hardening. Cases preserve the existing behavioral assertions. */
import { describe, expect, it, vi } from 'vitest'
import vm from 'node:vm'
import { EventSubscriberErrorCode, createEventChannel } from '../src/index.js'
import { attachEventErrorCode, codeExistingError } from '../src/errors.js'
import { createSystemTerminalRuntime } from '../src/internal/terminal-runtime.js'

describe('event-subscriber error and terminal hardening', () => {
  it('uses requested code text when coding frozen or non-error failures', () => {
    const frozen = Object.freeze(new TypeError('frozen signal'))
    const codedFrozen = attachEventErrorCode(frozen, EventSubscriberErrorCode.invalidSignal)
    expect(codedFrozen).toMatchObject({
      code: EventSubscriberErrorCode.invalidSignal,
      message: 'event-subscriber abort signal is invalid',
      cause: frozen
    })

    const codedValue = codeExistingError(
      Object.freeze(new Error('frozen signal')),
      EventSubscriberErrorCode.invalidSignal
    )
    expect(codedValue).toMatchObject({
      code: EventSubscriberErrorCode.invalidSignal,
      message: 'event-subscriber abort signal is invalid',
      cause: expect.any(Error)
    })
  })

  it('contains hostile queueMicrotask access and invocation failures', () => {
    const diagnostic = new Error('supplied diagnostic')
    const getterFailure = new Error('queue getter')
    const getterHost = {
      get queueMicrotask(): (callback: () => void) => void {
        throw getterFailure
      }
    }
    expect(() => createSystemTerminalRuntime(getterHost).enqueueThrow(diagnostic)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.unhandledListenerFailure,
        cause: diagnostic,
        errors: [diagnostic, getterFailure]
      })
    )

    const invokeFailure = new Error('queue invoke')
    const invokeHost = {
      queueMicrotask: () => {
        throw invokeFailure
      }
    }
    expect(() => createSystemTerminalRuntime(invokeHost).enqueueThrow(diagnostic)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.unhandledListenerFailure,
        cause: diagnostic,
        errors: [diagnostic, invokeFailure]
      })
    )
  })

  it('codes revoked thrown boundary values while preserving the original cause', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const options = {
      get taskId() {
        throw revoked.proxy
      }
    }
    let thrown: unknown
    try {
      createEventChannel().subscribe(() => undefined, options as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
    expect((thrown as { readonly cause?: unknown }).cause).toBe(revoked.proxy)
  })

  it('invokes terminal queueMicrotask with its original receiver', () => {
    const callbacks: (() => void)[] = []
    class Host {
      #calls = 0

      get calls(): number {
        return this.#calls
      }

      queueMicrotask(callback: () => void): void {
        this.#calls += 1
        callbacks.push(callback)
      }
    }
    const host = new Host()
    createSystemTerminalRuntime(host).enqueueThrow(new Error('terminal'))
    expect(host.calls).toBe(1)
    expect(callbacks).toHaveLength(1)
  })

  it('routes reporter and terminal thenable failures to the system sink', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const channel = createEventChannel<number>({
      report: () => {
        throw new Error('reporter failure')
      },
      terminalReport: () => Promise.reject(new Error('terminal failure'))
    })
    channel.subscribe(() => Promise.reject(new Error('listener failure')))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      code: EventSubscriberErrorCode.unhandledListenerFailure
    })
    consoleError.mockRestore()
  })

  it('continues terminal fallback after a hostile then getter', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const terminalFailure = new Error('terminal then getter')
    const terminalReport = () => {
      const thenProperty = ['t', 'h', 'e', 'n'].join('')
      const thenable = {}
      Object.defineProperty(thenable, thenProperty, {
        get() {
          throw terminalFailure
        }
      })
      return thenable as never
    }
    const channel = createEventChannel<number>({ terminalReport })
    channel.subscribe(() => Promise.reject(new Error('listener failure')))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    expect(consoleError.mock.calls[0][0]).toMatchObject({
      code: EventSubscriberErrorCode.unhandledListenerFailure
    })
    expect(consoleError.mock.calls[0][0].errors).toContain(terminalFailure)
    consoleError.mockRestore()
  })

  it('continues terminal fallback after a synchronous terminal throw', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const terminalFailure = new Error('terminal throw')
    const channel = createEventChannel<number>({
      terminalReport: () => {
        throw terminalFailure
      }
    })
    channel.subscribe(() => Promise.reject(new Error('listener failure')))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    expect(consoleError.mock.calls[0][0].errors).toContain(terminalFailure)
    consoleError.mockRestore()
  })

  it('routes an asynchronous reporter rejection to terminal fallback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const listenerFailure = new Error('listener failure')
    const reporterFailure = new Error('async reporter failure')
    const channel = createEventChannel<number>({
      report: () => Promise.reject(reporterFailure)
    })
    channel.subscribe(() => Promise.reject(listenerFailure))
    channel.publish(1)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce())
    const diagnostic = consoleError.mock.calls[0][0] as AggregateError
    expect(diagnostic.errors).toContain(listenerFailure)
    expect(diagnostic.errors).toContain(reporterFailure)
    consoleError.mockRestore()
  })

  it('synchronously throws when queueMicrotask is missing or non-callable', () => {
    const diagnostic = new Error('terminal diagnostic')
    const hosts: readonly object[] = [
      {},
      { queueMicrotask: undefined },
      { queueMicrotask: null },
      {
        get queueMicrotask() {
          return undefined
        }
      }
    ]
    for (const host of hosts) {
      expect(() => createSystemTerminalRuntime(host as never).enqueueThrow(diagnostic)).toThrow(
        diagnostic
      )
    }
  })

  it('wraps non-Error thrown values and hostile Error probes safely', () => {
    const values: readonly unknown[] = [{ reason: 'object' }, () => undefined, 'string']
    for (const value of values) {
      const coded = codeExistingError(value, EventSubscriberErrorCode.invalidChannel) as Error & {
        readonly cause?: unknown
        readonly code?: string
      }
      expect(coded).toBeInstanceOf(TypeError)
      expect(coded.code).toBe(EventSubscriberErrorCode.invalidChannel)
      expect(coded.cause).toBe(value)
    }
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const codedRevoked = codeExistingError(
      revoked.proxy,
      EventSubscriberErrorCode.invalidChannel
    ) as Error & { readonly cause?: unknown; readonly code?: string }
    expect(codedRevoked).toBeInstanceOf(TypeError)
    expect(codedRevoked.code).toBe(EventSubscriberErrorCode.invalidChannel)
    expect(codedRevoked.cause).toBe(revoked.proxy)
  })

  it('preserves a genuine cross-realm Error while coding it', () => {
    const foreignError = vm.runInNewContext('new TypeError("foreign")') as Error
    const coded = codeExistingError(
      foreignError,
      EventSubscriberErrorCode.invalidChannel
    ) as Error & { readonly code?: string }

    expect(coded).toBe(foreignError)
    expect(coded).toBeInstanceOf(foreignError.constructor as typeof Error)
    expect(coded.name).toBe('TypeError')
    expect(coded.stack).toBe(foreignError.stack)
    expect(coded.code).toBe(EventSubscriberErrorCode.invalidChannel)
  })

  it('reads queueMicrotask once and preserves its receiver', () => {
    const callbacks: (() => void)[] = []
    let reads = 0
    class Host {
      #calls = 0

      get calls(): number {
        return this.#calls
      }

      get queueMicrotask(): (callback: () => void) => void {
        reads += 1
        return (callback) => {
          this.#calls += 1
          callbacks.push(callback)
        }
      }
    }
    const host = new Host()
    const diagnostic = new Error('terminal')
    createSystemTerminalRuntime(host).enqueueThrow(diagnostic)

    expect(reads).toBe(1)
    expect(host.calls).toBe(1)
    expect(callbacks).toHaveLength(1)
  })
})
