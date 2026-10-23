import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { deferred } from '@migaia/utils/promise'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createRpcHost } from '@migaia/rpc-host'
import * as sdk from '@migaia/rpc-host/plugin'
import { processPlugin } from '@migaia/rpc-plugin-process'
import {
  sendQueueFeature,
  ipcLogFeature,
  IpcSendClass,
  IpcLogEventName,
  type IIpcLogRecord
} from '@migaia/rpc-plugin-process/features'
import sendQueue from '@migaia/rpc-plugin-process/features/send-queue'
import ipcLog from '@migaia/rpc-plugin-process/features/log'
import * as flow from '@migaia/rpc-plugin-process/features/flow-control'
import * as queueOwner from '../../../rpc-host/dist/core/plugins/send-queue.js'
import * as logOwner from '../../../rpc-host/dist/core/plugins/log.js'
import * as stderrOwner from '../../dist/process/stderr.js'
import type { IRuntimeByteConnection } from '@migaia/rpc-host/plugin'
import { envelope } from '../../../rpc-host/test/core/fixtures/physical-batch-envelope.js'

/** A native child entry carries actual bootstrap, application traffic, stderr and unit shutdown. */
const child = fileURLToPath(new URL('./fixtures/child.mts', import.meta.url))

/** Canonical control classification reads the same admitted ping route as the physical sender. */
function control(id: string) {
  return normalizeRpcEnvelope({
    kind: 'variation',
    id,
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'variation',
        variation: 'ping',
        applicationVersion: '1',
        senderId: 'feature-parent',
        targetId: 'feature-child',
        receiverId: 'feature-child',
        sentAt: 0
      }
    }
  })
}

describe('process connection feature wrappers', () => {
  it('shares the same two factories and original flow-control values across public imports', () => {
    expect(sendQueueFeature).toBe(sendQueue)
    expect(ipcLogFeature).toBe(ipcLog)
    expect(flow.IpcSendClass).toBe(IpcSendClass)
    expect(flow.IpcLogEventName).toBe(IpcLogEventName)
    expect(IpcSendClass).toBe(sdk.IpcSendClass)
    expect(IpcLogEventName).toBe(sdk.IpcLogEventName)
    expect(Object.keys(flow).toSorted()).toEqual(['IpcLogEventName', 'IpcSendClass'])
  })

  it('applies explicit data capacity while preserving control capacity on one actual process gate', async () => {
    /** Spies retain the actual canonical constructors, so neither gate nor log is simulated. */
    const queues = vi.spyOn(queueOwner, 'createIpcSendQueueFeature')
    /** The actual log installation must hold the same gate returned by the sole queue constructor. */
    const logs = vi.spyOn(logOwner, 'createIpcLogFeature')
    /** Feature configuration is captured before a later caller mutation. */
    const capacity = { maxPendingData: 1 }
    /** This exact registered object travels through Host deployment preparation. */
    const queue = sendQueueFeature(capacity)
    capacity.maxPendingData = 8
    /** The explicit feature overrides only its fields and its sink. */
    const records: IIpcLogRecord[] = []
    /** A legacy IPC sink must not receive records after an explicit log feature supersedes it. */
    const oldLog = vi.fn()
    /** Physical admission is held only within the original connection gate. */
    const released = deferred<void>()
    /** The occupied data lane is observable before another public call is attempted. */
    const started = deferred<void>()
    /** All actual diagnostics remain available if native setup fails. */
    const reports: unknown[] = []
    /** A real public process plugin spawns and handshakes the independent child host. */
    const host = await createRpcHost({
      self: { name: 'feature-parent', instanceId: 'feature-parent' },
      plugins: [
        processPlugin({
          spawn: { entry: child },
          ipc: { maxPendingData: 8, maxPendingControl: 1, log: oldLog }
        }),
        queue,
        ipcLogFeature({
          report: (record) => {
            records.push(record)
          }
        })
      ],
      report: (error) => reports.push(error)
    })
    try {
      expect(await host.request('echo', 42)).toBe(42)
      expect(queues).toHaveBeenCalledTimes(1)
      expect(logs).toHaveBeenCalledTimes(1)
      /** This is the actual gate installed on the child process's physical byte connection. */
      const gate = queues.mock.results[0]!.value.gate
      expect(logs.mock.calls[0]![0].gate).toBe(gate)
      expect(queues.mock.calls[0]![0]).toMatchObject({ maxPendingData: 1, maxPendingControl: 1 })
      records.length = 0
      oldLog.mockClear()
      /** One canonical data admission owns capacity while its write continuation remains pending. */
      const pending = gate.run(envelope('occupied'), () => {
        started.resolve()
        return released.promise
      })
      await started.promise
      await expect(host.notify('echo', 'saturated')).rejects.toMatchObject({ code: 'OVERLOADED' })
      /** Reserved control capacity remains independent while the data lane is completely occupied. */
      const acceptedControl = gate.run(control('one-control'), () => undefined)
      await expect(gate.run(control('full-control'), () => undefined)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(
        records.filter((record) => record.name === IpcLogEventName['ipc.backlog.rejected'])
      ).toHaveLength(2)
      expect(oldLog).not.toHaveBeenCalled()
      released.resolve()
      await Promise.all([pending, acceptedControl])
      expect(await host.request('echo', 43)).toBe(43)
      expect(queues).toHaveBeenCalledTimes(1)
    } finally {
      released.resolve()
      await host.close()
      queues.mockRestore()
      logs.mockRestore()
    }
  })

  it('keeps native stderr on the selected log and unsubscribes it before physical connection close', async () => {
    /** The sink observes actual native stderr without receiving its raw source bytes. */
    const records: IIpcLogRecord[] = []
    /** Wait for the real stderr event instead of a scheduler delay or generated diagnostic. */
    const observed = deferred<void>()
    /** Original cleanup operations append only their observed order to this test-local array. */
    const closed: string[] = []
    /** The actual canonical connection remains available to invoke its own close transaction. */
    let connection: IRuntimeByteConnection | undefined
    /** Preserve the exact canonical byte constructor and wrap only the native close observation. */
    const createByte = sdk.createRuntimeEventByteIO
    /** The actual native close still executes once through the original resource. */
    const byte = vi.spyOn(sdk, 'createRuntimeEventByteIO').mockImplementation((...args) => {
      const physical = args[2]
      return createByte(
        args[0],
        args[1],
        {
          close() {
            closed.push('physical')
            physical.close()
          }
        },
        args[3],
        args[4]
      )
    })
    /** Only the original stderr helper attaches the subscription to its existing connection. */
    const attach = stderrOwner.attachProcessChannelStderr
    /** Observe the original native unsubscribe, retaining the exact channel identity and callback. */
    const stderr = vi
      .spyOn(stderrOwner, 'attachProcessChannelStderr')
      .mockImplementation((channel, options) => {
        const subscribe = options.ipc.stderr!
        connection = channel
        return attach(channel, {
          ...options,
          ipc: {
            ...options.ipc,
            stderr(listener) {
              const unsubscribe = subscribe(listener)
              return () => {
                closed.push('stderr')
                unsubscribe()
              }
            }
          }
        })
      })
    /** These reports preserve actual channel retirement diagnostics during explicit close. */
    const reports: unknown[] = []
    /** A normal spawned process supplies stderr through its original launcher output path. */
    const host = await createRpcHost({
      plugins: [
        processPlugin({ spawn: { entry: child } }),
        ipcLogFeature({
          report(record) {
            records.push(record)
            if (record.name === IpcLogEventName['ipc.stderr']) observed.resolve()
          }
        })
      ],
      report: (error) => reports.push(error)
    })
    try {
      expect(await host.request('stderr')).toEqual(expect.any(Number))
      await observed.promise
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(records.filter((record) => record.name === IpcLogEventName['ipc.stderr'])).toEqual([
        expect.objectContaining({ text: '[child stderr redacted]' })
      ])
      expect(JSON.stringify(records)).not.toContain('private-process-feature-stderr')
      expect(connection).toBeDefined()
      await connection!.close()
      expect(closed).toEqual(['stderr', 'physical'])
      await connection!.close()
      expect(closed).toEqual(['stderr', 'physical'])
    } finally {
      await host.close()
      stderr.mockRestore()
      byte.mockRestore()
    }
  })
})
