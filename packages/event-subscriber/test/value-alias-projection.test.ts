import { describe, expect, it, vi } from 'vitest'
import {
  createEventChannel,
  createEventHub,
  EventSubscriberErrorCode,
  invokeParallelSettled,
  invokeSerialSettled,
  invokeTaskSettled
} from '../src/index.js'

type IValue = {
  readonly data: {
    readonly leaf: object | undefined
  }
}

describe('value alias projection', () => {
  it('ES-T150 ESVA-T01/ESVA-T03/ESVA-T05 accepts static config and probes once for all listeners', () => {
    const leaf = {}
    let reads = 0
    const value: IValue = {
      data: {
        get leaf() {
          reads += 1
          return leaf
        }
      }
    }
    const contexts: unknown[] = []
    const channel = createEventChannel<
      IValue,
      void,
      undefined,
      {
        readonly readPath: 'data.leaf'
        readonly alias: 'resource'
      }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' } })
    channel.subscribe((event) => {
      contexts.push(event.resource)
    })
    channel.subscribe((event) => {
      contexts.push(event.resource)
      const descriptor = Object.getOwnPropertyDescriptor(event, 'resource')
      expect(descriptor).toMatchObject({ enumerable: true, writable: false, configurable: false })
    })

    channel.publish(value)

    expect(reads).toBe(1)
    expect(contexts).toEqual([leaf, leaf])
    expect(contexts[0]).toBe(contexts[1])
  })

  it('ES-T151 ESVA-T02 applies config independently to Hub keys', () => {
    const hub = createEventHub<
      { ready: { data: { id: number } }; text: { data: { id: string } } },
      undefined,
      { readonly readPath: 'data.id'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.id', alias: 'resource' } })
    const values: unknown[] = []
    hub.subscribe('ready', (event) => {
      values.push(event.resource)
    })
    hub.subscribe('text', (event) => {
      values.push(event.resource)
    })

    hub.publish('ready', { data: { id: 1 } })
    hub.publish('text', { data: { id: 'one' } })

    expect(values).toEqual([1, 'one'])
  })

  it('ES-T152 ESVA-T06/ESVA-T07 preserves original value and controls', () => {
    const value = { data: { leaf: 4 } }
    const channel = createEventChannel<
      typeof value,
      void,
      undefined,
      {
        readonly readPath: 'data.leaf'
        readonly alias: 'resource'
      }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' } })
    let observed:
      | { value: typeof value; resource: number | undefined; taskId: string | undefined }
      | undefined
    channel.subscribe(
      (event) => {
        observed = event
        event.setTaskId('next')
        event.abort('stop')
      },
      { taskId: 'current' }
    )

    channel.publish(value)

    expect(observed?.value).toBe(value)
    expect(observed?.resource).toBe(4)
    expect(observed?.taskId).toBe('current')
    expect(observed && 'abort' in observed).toBe(true)
  })

  it('ES-T153 ESVA-T08/ESVA-T10 distinguishes missing, blocked, and undefined leaves', async () => {
    const report = vi.fn()
    const channel = createEventChannel<
      { data?: { leaf?: number } | null },
      void,
      undefined,
      {
        readonly readPath: 'data.leaf'
        readonly alias: 'resource'
      }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    const aliases: unknown[] = []
    channel.subscribe((event) => {
      aliases.push(event.resource)
    })
    channel.publish({})
    channel.publish({ data: null })
    channel.publish({ data: { leaf: undefined } })

    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2))
    expect(aliases).toEqual([undefined, undefined, undefined])
    expect(report.mock.calls[0]?.[0].error).toMatchObject({
      code: EventSubscriberErrorCode.valueProjectionFailed
    })
    expect(report.mock.calls[1]?.[0].error).toMatchObject({
      code: EventSubscriberErrorCode.valueProjectionFailed
    })
  })

  it('ES-T154 ESVA-T09 preserves getter cause and reporter failure without suppressing delivery', async () => {
    const getterFailure = new Error('leaf failed')
    const terminal = vi.fn()
    const report = vi.fn(() => {
      throw new Error('report failed')
    })
    const value = {
      data: {
        get leaf(): never {
          throw getterFailure
        }
      }
    }
    const channel = createEventChannel<
      typeof value,
      void,
      undefined,
      {
        readonly readPath: 'data.leaf'
        readonly alias: 'resource'
      }
    >({
      valueConfig: { readPath: 'data.leaf', alias: 'resource' },
      report,
      terminalReport: terminal
    })
    const listener = vi.fn()
    channel.subscribe(listener)

    channel.publish(value)

    expect(listener).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(terminal).toHaveBeenCalledOnce())
    const diagnostic = terminal.mock.calls[0]?.[0]
    expect(diagnostic).toMatchObject({ code: EventSubscriberErrorCode.valueProjectionFailed })
    expect((diagnostic.errors[0] as Error & { readonly cause?: unknown }).cause).toBe(getterFailure)
  })

  it('ES-T155 ESVA-T11 disables projection before reading alias for blank paths', () => {
    let aliasReads = 0
    const valueConfig = {
      readPath: '   ',
      get alias(): string {
        aliasReads += 1
        return 'resource'
      }
    }
    const channel = createEventChannel<{ data: { leaf: number } }>({
      valueConfig: valueConfig as never
    })
    let context: Record<string, unknown> | undefined
    channel.subscribe((event) => {
      context = event
    })
    channel.publish({ data: { leaf: 1 } })

    expect(aliasReads).toBe(0)
    expect(context && Object.hasOwn(context, 'resource')).toBe(false)

    const missingReadPathConfig = {
      get alias(): string {
        aliasReads += 1
        return 'missing'
      }
    }
    const unconfigured = createEventChannel<{ data: { leaf: number } }>({
      valueConfig: missingReadPathConfig as never
    })
    unconfigured.subscribe(() => undefined)
    unconfigured.publish({ data: { leaf: 1 } })
    expect(aliasReads).toBe(0)
  })

  it('ES-T156 ESVA-T12/ESVA-T13 rejects active alias collisions before Hub state', () => {
    expect(() =>
      createEventChannel<{ data: { leaf: number } }>({
        valueConfig: { readPath: 'data.leaf', alias: 'value' } as never
      })
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions }))
    expect(() =>
      createEventHub<{ ready: { data: { leaf: number } } }>({
        valueConfig: { readPath: 'data.leaf', alias: '__proto__' } as never
      })
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions }))
  })

  it('ES-T157 ESVA-T16/ESVA-T17 projects through async invoke helpers once', async () => {
    let reads = 0
    const channel = createEventChannel<
      { data: { get leaf(): number } },
      number,
      undefined,
      {
        readonly readPath: 'data.leaf'
        readonly alias: 'resource'
      }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' } })
    channel.subscribe((event) => {
      reads += event.resource ?? 0
      return event.resource ?? 0
    })
    const result = await invokeParallelSettled(channel, {
      data: {
        get leaf() {
          reads += 1
          return 3
        }
      }
    })

    expect(result).toMatchObject([{ status: 'fulfilled', value: 3 }])
    expect(reads).toBe(4)
  })

  it('ES-T158 skips projection probing when serial invocation has no targets', async () => {
    let reads = 0
    const channel = createEventChannel<
      { readonly data: { readonly leaf: number } },
      void,
      undefined,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' } })

    const result = await invokeSerialSettled(channel, {
      data: {
        get leaf() {
          reads += 1
          return 1
        }
      }
    })

    expect(result).toEqual([])
    expect(reads).toBe(0)
  })

  it('ES-T159 ESVA-T07/ESVA-T09 reports after all parallel listeners enter', async () => {
    const order: string[] = []
    const entries: Array<{ readonly taskId: string | undefined; readonly aborted: boolean }> = []
    const report = vi.fn(
      (failure: {
        readonly event: {
          abort(reason?: unknown): void
          setTaskId(taskId: string | undefined): void
        }
      }) => {
        order.push('report')
        failure.event.abort('report')
        failure.event.setTaskId('report-task')
      }
    )
    const channel = createEventChannel<
      { readonly data: { readonly leaf: number } },
      void,
      undefined,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    channel.subscribe(
      (event) => {
        order.push('first')
        entries.push({ taskId: event.taskId, aborted: event.aborted })
      },
      { taskId: 'first-task' }
    )
    channel.subscribe(
      (event) => {
        order.push('second')
        entries.push({ taskId: event.taskId, aborted: event.aborted })
      },
      { taskId: 'second-task' }
    )

    await invokeParallelSettled(channel, {
      data: {
        get leaf(): number {
          throw new Error('parallel projection failure')
        }
      }
    })

    expect(order).toEqual(['first', 'second', 'report'])
    expect(entries).toEqual([
      { taskId: 'first-task', aborted: false },
      { taskId: 'second-task', aborted: false }
    ])
    expect(report).toHaveBeenCalledOnce()
  })

  it('ES-T160 ESVA-T07/ESVA-T09 reports after all serial settlements', async () => {
    const order: string[] = []
    const entries: Array<{ readonly taskId: string | undefined; readonly aborted: boolean }> = []
    const report = vi.fn(
      (failure: {
        readonly event: {
          abort(reason?: unknown): void
          setTaskId(taskId: string | undefined): void
        }
      }) => {
        order.push('report')
        failure.event.abort('report')
        failure.event.setTaskId('report-task')
      }
    )
    const channel = createEventChannel<
      { readonly data: { readonly leaf: number } },
      void,
      undefined,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    channel.subscribe(
      async (event) => {
        order.push('first-start')
        entries.push({ taskId: event.taskId, aborted: event.aborted })
        await Promise.resolve()
        order.push('first-end')
      },
      { taskId: 'first-task' }
    )
    channel.subscribe(
      (event) => {
        order.push('second')
        entries.push({ taskId: event.taskId, aborted: event.aborted })
      },
      { taskId: 'second-task' }
    )

    await invokeSerialSettled(channel, {
      data: {
        get leaf(): number {
          throw new Error('serial projection failure')
        }
      }
    })

    expect(order).toEqual(['first-start', 'first-end', 'second', 'report'])
    expect(entries).toEqual([
      { taskId: 'first-task', aborted: false },
      { taskId: 'second-task', aborted: false }
    ])
    expect(report).toHaveBeenCalledOnce()
  })

  it('ES-T161 ESVA-T07/ESVA-T09 reports after the selected task listener enters', async () => {
    const order: string[] = []
    const report = vi.fn(
      (failure: {
        readonly event: {
          abort(reason?: unknown): void
          setTaskId(taskId: string | undefined): void
        }
      }) => {
        order.push('report')
        failure.event.abort('report')
        failure.event.setTaskId('report-task')
      }
    )
    const channel = createEventChannel<
      { readonly data: { readonly leaf: number } },
      void,
      undefined,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    channel.subscribe(
      (event) => {
        order.push(`listener:${event.taskId}:${event.aborted}`)
      },
      { taskId: 'selected-task' }
    )

    const result = await invokeTaskSettled(channel, 'selected-task', {
      data: {
        get leaf(): number {
          throw new Error('task projection failure')
        }
      }
    })

    expect(result).toMatchObject({ status: 'fulfilled' })
    expect(order).toEqual(['listener:selected-task:false', 'report'])
    expect(report).toHaveBeenCalledOnce()
  })
})
