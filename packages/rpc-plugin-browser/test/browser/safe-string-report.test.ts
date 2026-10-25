import { describe, expect, it } from 'vitest'
import {
  createDedicatedWorkerCarrier,
  subscribeWorkerErrors
} from '../../dist/browser/adapters/dedicated-worker.js'

describe('safeString failure reporting', () => {
  it('reports Worker conversion and message getter failures before primary errors', async () => {
    /** Only actual native callbacks may enter either production Worker error path. */
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>()
    /** This borrowed native source remains usable after actual carrier cleanup. */
    const port = {
      postMessage() {},
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        listeners.set(type, listener)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      }
    }
    /** Original diagnostic ordering is shared by real report and receiver.error ports. */
    const failures: unknown[] = []
    /** This exact native composition is also called by dedicatedWorkerPlugin.open. */
    const carrier = createDedicatedWorkerCarrier(port, { report: (error) => failures.push(error) })
    carrier.subscribe({
      frame: () => undefined,
      error: (error) => failures.push(error),
      close: () => undefined
    })
    /** String conversion failure must be reported before the original hostile data getter. */
    const conversion = new Error('worker conversion')
    /** This original non-Error native getter failure owns its hostile diagnostic conversion. */
    const readFailure = {
      toString() {
        throw conversion
      }
    }
    listeners.get('message')?.({
      get data(): never {
        throw readFailure
      }
    } as unknown as MessageEvent)
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT', cause: conversion })
    expect(failures[1]).toMatchObject({ code: 'TRANSPORT', cause: readFailure })
    await carrier.close()
    /** The original native error mapper is reacquired on the still-borrowed Worker source. */
    const stop = subscribeWorkerErrors(
      port,
      (error) => failures.push(error),
      (error) => failures.push(error)
    )
    /** A separate live native error operation preserves its exact getter failure before primary. */
    const getterFailure = new Error('message getter')
    listeners.get('error')?.({
      get message(): never {
        throw getterFailure
      }
    } as unknown as MessageEvent)
    expect(failures).toHaveLength(4)
    expect(failures[2]).toMatchObject({ code: 'TRANSPORT', cause: getterFailure })
    expect(failures[3]).toMatchObject({ code: 'TRANSPORT' })
    stop()
  })
})
