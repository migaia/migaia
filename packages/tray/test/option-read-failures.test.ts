import { describe, expect, it } from 'vitest'
import { createTray } from '../src/hosts/parent/tray.ts'
import { createRuntime } from '../src/runtime/create-runtime.ts'
import { TrayErrorCode } from '../src/error-code.ts'

/** Captures a synchronous failure. */
function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('createTray option reads', () => {
  it('rejects missing or unreadable hosts with TRAY_HOST_INVALID', () => {
    expect(thrownBy(() => createTray(null as never))).toMatchObject({
      code: TrayErrorCode.hostInvalid
    })
    expect(thrownBy(() => createTray({ hosts: 'none' } as never))).toMatchObject({
      code: TrayErrorCode.hostInvalid
    })
    const getterFailure = new Error('hosts getter failed')
    const thrown = thrownBy(() =>
      createTray({
        get hosts(): never {
          throw getterFailure
        }
      } as never)
    )
    expect(thrown).toMatchObject({ code: TrayErrorCode.hostInvalid })
    expect([thrown, (thrown as Error).cause]).toContain(getterFailure)
  })

  it('rejects a routing value that cannot be iterated with TRAY_ROUTING_INVALID', () => {
    expect(thrownBy(() => createTray({ hosts: [], routing: 5 } as never))).toMatchObject({
      code: TrayErrorCode.routingInvalid
    })
  })
})

describe('createRuntime option reads', () => {
  it('codes a throwing shutdown getter and rejects hosts without a runtime bridge', () => {
    const getterFailure = new Error('shutdown getter failed')
    const thrown = thrownBy(() =>
      createRuntime({ on: () => () => {} } as never, {
        get shutdown(): never {
          throw getterFailure
        }
      })
    )
    expect(thrown).toMatchObject({ code: TrayErrorCode.runtimeContractInvalid })
    expect([thrown, (thrown as Error).cause]).toContain(getterFailure)
    expect(thrownBy(() => createRuntime(null as never))).toMatchObject({
      code: TrayErrorCode.runtimeContractInvalid
    })
    expect(thrownBy(() => createRuntime({ on: () => () => {} } as never))).toMatchObject({
      code: TrayErrorCode.runtimeContractInvalid
    })
  })
})
