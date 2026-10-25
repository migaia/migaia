import { expect, it } from 'vitest'
import { createNodeThreadCarrier } from '../../dist/threads/channel.js'

it('reports a MessagePort conversion failure before deserialization failure', async () => {
  /** The same original native subscription receives the actual messageerror argument. */
  const listeners = new Map<string, (value?: unknown) => void>()
  /** This retained native fixture performs no semantic decoding or error conversion itself. */
  const port = {
    postMessage() {},
    on(event: string, listener: (value?: unknown) => void) {
      listeners.set(event, listener)
    },
    off(event: string) {
      listeners.delete(event)
    },
    listenerCount(event: string) {
      return Number(listeners.has(event))
    }
  }
  /** The migrated native Thread owner lends its real SDK carrier without a retired adapter. */
  const failures: unknown[] = []
  /** Native diagnostic failures use the actual Host report sink without retiring the valid carrier. */
  const carrier = createNodeThreadCarrier(port, 'original-message-port', (error) =>
    failures.push(error)
  )
  carrier.subscribe({
    frame() {},
    error() {},
    close() {}
  })
  /** Failed native diagnostic conversion remains the same original Error object. */
  const conversion = new Error('port conversion')
  try {
    listeners.get('messageerror')?.({
      toString() {
        throw conversion
      }
    })
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT', cause: conversion })
    expect(failures[1]).toMatchObject({ code: 'TRANSPORT' })
  } finally {
    await carrier.close()
  }
})
