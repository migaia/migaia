import { describe, expect, it } from 'vitest'
import { createWebWorkerTransport } from '../../src/browser/adapters/web-worker.js'

describe('[A11] safeString failure reporting', () => {
  it('reports Worker conversion and message getter failures before primary errors', () => {
    const listeners = new Map<string, (event: Event) => void>()
    const transport = createWebWorkerTransport({
      postMessage() {},
      addEventListener(type, listener) {
        listeners.set(type, listener)
      },
      removeEventListener(type) {
        listeners.delete(type)
      }
    })
    const failures: unknown[] = []
    transport.onTransportError?.((error) => failures.push(error))
    transport.subscribe(() => undefined)
    const conversion = new Error('worker conversion')
    const readFailure = {
      toString() {
        throw conversion
      }
    }
    listeners.get('message')?.({
      get data(): never {
        throw readFailure
      }
    } as unknown as Event)
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT', cause: conversion })
    expect(failures[1]).toMatchObject({ code: 'TRANSPORT', cause: readFailure })
    const getterFailure = new Error('message getter')
    listeners.get('error')?.({
      get message(): never {
        throw getterFailure
      }
    } as unknown as Event)
    expect(failures).toHaveLength(4)
    expect(failures[2]).toMatchObject({ code: 'TRANSPORT', cause: getterFailure })
    expect(failures[3]).toMatchObject({ code: 'TRANSPORT' })
  })
})
