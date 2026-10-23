import { createLoggerError, createLoggerTypeError, LoggerErrorCode } from '../../errors.js'
import { requireInteger } from './store.js'
import { snapshotPayload, snapshotRecords } from './snapshot.js'
import {
  captureDurableOptions,
  captureAppendPort,
  captureLimit,
  createDurableRuntime
} from './plugin-runtime.js'
import { DurableKind, LogOperation, LogStage } from './state-constants.js'
import { DurableText } from './text.js'
import type { IBinlogExt, IBinlogOptions, IDurablePlugin, ILogRecord } from './types.js'

/** One cursor and at most one in-flight callback; no live record queue accumulates per subscriber. */
type ICursor = {
  nextSeq: number
  active: boolean
  running: boolean
  wake: boolean
  listener: (record: ILogRecord) => void | Promise<void>
}
/** Adds an ordered history/live view while borrowing the original resource until uninstall. */
export function binlog(options: IBinlogOptions): IDurablePlugin<IBinlogExt> {
  options = captureDurableOptions(options)
  if (options.echo !== undefined && typeof options.echo !== 'boolean')
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
  return {
    name: DurableKind.binlog,
    config: {},
    install: (core) => {
      const runtime = createDurableRuntime(core, options, DurableKind.binlog)
      /** A single source subscription wakes all current cursors without duplicating records. */
      const cursors = new Set<ICursor>()
      let offSource: (() => void) | undefined
      /** Metadata-only echo remains part of the ordinary logger pipeline. */
      const echo = async (seqs: readonly number[]): Promise<void> => {
        if (!options.echo || !runtime.active()) return
        for (const seq of seqs) {
          const row = (await runtime.store.read(seq, 1))[0]
          if (row && runtime.active())
            core.dispatchRaw({
              tag: DurableKind.binlog,
              message: row.kind,
              meta: { seq: row.seq, time: row.time }
            })
        }
      }
      /** Stops one cursor and returns the source registration when no subscriber needs it. */
      const cancel = (cursor: ICursor): void => {
        if (!cursor.active) return
        runtime.observe(() => ({
          stage: LogStage.beforeLogOperation,
          owner: DurableKind.binlog,
          operation: LogOperation.cancel
        }))
        cursor.active = false
        cursors.delete(cursor)
        if (cursors.size === 0) {
          offSource?.()
          offSource = undefined
        }
        runtime.observe(() => ({
          stage: LogStage.afterLogOperation,
          owner: DurableKind.binlog,
          operation: LogOperation.cancel
        }))
      }
      /** Callback completion advances only this cursor; slow listeners never enter the write FIFO. */
      const pump = async (cursor: ICursor): Promise<void> => {
        if (cursor.running || !cursor.active || !runtime.active()) return
        cursor.running = true
        try {
          do {
            cursor.wake = false
            while (cursor.active && runtime.active()) {
              const rows = await runtime.store.read(cursor.nextSeq, 1)
              if (!cursor.active || !runtime.active()) break
              const row = rows[0]
              if (!row) {
                if ((await runtime.store.lastSeq()) >= cursor.nextSeq)
                  throw createLoggerError(
                    LoggerErrorCode.logSubscriptionTruncated,
                    DurableText.truncated
                  )
                break
              }
              if (row.seq !== cursor.nextSeq)
                throw createLoggerError(
                  LoggerErrorCode.logSubscriptionTruncated,
                  DurableText.truncated
                )
              runtime.observe(() => ({
                stage: LogStage.beforeLogOperation,
                owner: DurableKind.binlog,
                operation: LogOperation.deliver,
                seq: row.seq
              }))
              try {
                await cursor.listener({ ...row, payload: snapshotPayload(row.payload) })
              } catch (error) {
                cancel(cursor)
                runtime.reportHook(error)
                runtime.observe(() => ({
                  stage: LogStage.onLogOperationError,
                  owner: DurableKind.binlog,
                  operation: LogOperation.deliver
                }))
                return
              }
              runtime.observe(() => ({
                stage: LogStage.afterLogOperation,
                owner: DurableKind.binlog,
                operation: LogOperation.deliver,
                seq: row.seq
              }))
              cursor.nextSeq = row.seq + 1
            }
          } while (cursor.wake && cursor.active && runtime.active())
        } catch (error) {
          cancel(cursor)
          runtime.reportHook(error)
        } finally {
          cursor.running = false
        }
      }
      runtime.cleanups.add(() => {
        for (const cursor of cursors) cursor.active = false
        cursors.clear()
        offSource?.()
        offSource = undefined
      })
      const api: IBinlogExt['binlog'] = {
        ready: runtime.ready,
        whenIdle: runtime.whenIdle,
        append: (kind, payload, appendOptions) => {
          let captured: ReturnType<typeof snapshotRecords>
          let port: import('./types.js').ILogAppendPort | undefined
          try {
            runtime.admit()
            captured = snapshotRecords([{ kind, payload }])
            port = captureAppendPort(appendOptions)
          } catch (error) {
            return Promise.reject(error)
          }
          const result = port
            ? runtime.appendPort(port, captured, (seqs) => {
                void echo(seqs).catch(runtime.report)
              })
            : runtime.run(LogOperation.append, async () => {
                const seqs = await runtime.store.append(captured)
                await echo(seqs)
                return seqs
              })
          return result.then((seqs) => seqs[0])
        },
        appendBatch: (records, appendOptions) => {
          let captured: ReturnType<typeof snapshotRecords>
          let port: import('./types.js').ILogAppendPort | undefined
          try {
            runtime.admit()
            captured = snapshotRecords(records)
            port = captureAppendPort(appendOptions)
          } catch (error) {
            return Promise.reject(error)
          }
          if (port)
            return runtime.appendPort(port, captured, (seqs) => {
              void echo(seqs).catch(runtime.report)
            })
          return runtime.run(LogOperation.append, async () => {
            const seqs = await runtime.store.append(captured)
            await echo(seqs)
            return seqs
          })
        },
        read: (fromSeq, readOptions) => {
          let limit: number
          try {
            requireInteger(fromSeq)
            limit = captureLimit(readOptions)
          } catch (error) {
            return Promise.reject(error)
          }
          return runtime.run(LogOperation.read, () => runtime.store.read(fromSeq, limit))
        },
        lastSeq: () => runtime.run(LogOperation.lastSeq, () => runtime.store.lastSeq()),
        truncate: (beforeSeq) => {
          try {
            requireInteger(beforeSeq)
          } catch (error) {
            return Promise.reject(error)
          }
          return runtime.run(LogOperation.truncate, async () => {
            await runtime.store.truncate(beforeSeq)
            for (const cursor of cursors)
              if (cursor.nextSeq < beforeSeq) {
                cancel(cursor)
                runtime.reportHook(
                  createLoggerError(LoggerErrorCode.logSubscriptionTruncated, DurableText.truncated)
                )
              }
          })
        },
        subscribe: (fromSeq, listener) => {
          runtime.admit()
          requireInteger(fromSeq)
          if (typeof listener !== 'function')
            throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
          const cursor: ICursor = {
            nextSeq: fromSeq,
            active: true,
            running: false,
            wake: true,
            listener
          }
          void runtime
            .run(LogOperation.subscribe, async () => {
              if (!cursor.active || !runtime.active()) return
              cursors.add(cursor)
              if (!offSource)
                offSource = runtime.store.onAppend(() => {
                  for (const current of cursors) {
                    current.wake = true
                    void pump(current)
                  }
                })
              await runtime.store.lastSeq()
              void pump(cursor)
            })
            .catch(() => {
              cursor.active = false
            })
          return () => cancel(cursor)
        }
      }
      return { binlog: api }
    }
  }
}
