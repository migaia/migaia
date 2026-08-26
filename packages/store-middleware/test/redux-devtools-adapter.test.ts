import { describe, expect, it } from 'vitest'
import { createReduxDevToolsAdapter, type IReduxDevToolsMessage } from '../src/index'

type IState = { readonly count: number }

function makeConnection() {
  const initCalls: IState[] = []
  const sendCalls: Array<{ action: unknown; state: IState }> = []
  let listener: ((message: IReduxDevToolsMessage) => void) | undefined
  return {
    connection: {
      init: (state: IState) => initCalls.push(state),
      send: (action: unknown, state: IState) => sendCalls.push({ action, state }),
      subscribe: (l: (message: IReduxDevToolsMessage) => void) => {
        listener = l
        return () => {
          listener = undefined
        }
      }
    },
    initCalls,
    sendCalls,
    emit: (message: IReduxDevToolsMessage) => listener?.(message)
  }
}

describe('createReduxDevToolsAdapter', () => {
  it('init() forwards the state to the underlying connection', () => {
    const { connection, initCalls } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    adapter.init({ count: 1 })
    expect(initCalls).toEqual([{ count: 1 }])
  })

  it('send() labels action events as "name:phase"', () => {
    const { connection, sendCalls } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const event = { type: 'action', phase: 'start', name: 'increment', timestamp: 1 } as const
    adapter.send(event, { count: 1 })
    expect(sendCalls).toEqual([{ action: { type: 'increment:start', event }, state: { count: 1 } }])
  })

  it('send() labels state events with just the event name', () => {
    const { connection, sendCalls } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const event = {
      type: 'state',
      name: 'store:update',
      timestamp: 1,
      previous: { count: 0 },
      next: { count: 1 }
    } as const
    adapter.send(event, { count: 1 })
    expect(sendCalls[0]?.action).toEqual({ type: 'store:update', event })
  })

  it('send() labels error events as "error:phase"', () => {
    const { connection, sendCalls } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const event = {
      type: 'error',
      phase: 'trace-listener',
      timestamp: 1,
      error: new Error('boom')
    } as const
    adapter.send(event, { count: 1 })
    expect(sendCalls[0]?.action).toEqual({ type: 'error:trace-listener', event })
  })

  it('subscribe() ignores messages that are not type "DISPATCH"', () => {
    const { connection, emit } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const received: unknown[] = []
    adapter.subscribe?.((command) => received.push(command))
    emit({ type: 'OTHER', payload: { type: 'COMMIT' } })
    expect(received).toEqual([])
  })

  it('subscribe() maps DISPATCH/COMMIT to { type: "commit" }', () => {
    const { connection, emit } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const received: unknown[] = []
    adapter.subscribe?.((command) => received.push(command))
    emit({ type: 'DISPATCH', payload: { type: 'COMMIT' } })
    expect(received).toEqual([{ type: 'commit' }])
  })

  it.each(['JUMP_TO_STATE', 'JUMP_TO_ACTION', 'ROLLBACK'])(
    'subscribe() maps DISPATCH/%s with valid state JSON to { type: "jump", state }',
    (payloadType) => {
      const { connection, emit } = makeConnection()
      const adapter = createReduxDevToolsAdapter(connection)
      const received: unknown[] = []
      adapter.subscribe?.((command) => received.push(command))
      emit({ type: 'DISPATCH', payload: { type: payloadType }, state: '{"count":5}' })
      expect(received).toEqual([{ type: 'jump', state: { count: 5 } }])
    }
  )

  it('subscribe() maps DISPATCH/RESET with valid state JSON to { type: "reset", state }', () => {
    const { connection, emit } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const received: unknown[] = []
    adapter.subscribe?.((command) => received.push(command))
    emit({ type: 'DISPATCH', payload: { type: 'RESET' }, state: '{"count":0}' })
    expect(received).toEqual([{ type: 'reset', state: { count: 0 } }])
  })

  it('subscribe() silently ignores unparsable state JSON', () => {
    const { connection, emit } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const received: unknown[] = []
    adapter.subscribe?.((command) => received.push(command))
    expect(() =>
      emit({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' }, state: 'not json' })
    ).not.toThrow()
    expect(received).toEqual([])
  })

  it('subscribe() ignores JUMP/RESET messages with no state payload', () => {
    const { connection, emit } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const received: unknown[] = []
    adapter.subscribe?.((command) => received.push(command))
    emit({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' } })
    expect(received).toEqual([])
  })

  it('subscribe() ignores unknown payload types', () => {
    const { connection, emit } = makeConnection()
    const adapter = createReduxDevToolsAdapter(connection)
    const received: unknown[] = []
    adapter.subscribe?.((command) => received.push(command))
    emit({ type: 'DISPATCH', payload: { type: 'UNKNOWN_ACTION' }, state: '{"count":0}' })
    expect(received).toEqual([])
  })
})
