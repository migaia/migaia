import { createLoggerError, createLoggerTypeError, LoggerErrorCode } from '../../errors.js'
import {
  captureDurableOptions,
  captureAppendPort,
  captureUndoListOptions,
  createDurableRuntime,
  type IDurableRuntime
} from './plugin-runtime.js'
import { requireText, snapshotPayload } from './snapshot.js'
import { DurableKind, UNDO_PLUGIN_NAME, LogOperation, LogRecordState } from './state-constants.js'
import { DurableText } from './text.js'
import type {
  IDurablePlugin,
  IDurablePluginOptions,
  ILogPayload,
  ILogRecord,
  IUndoImage,
  IUndoLogExt
} from './types.js'

/** Active images are indexed in append order, which is nondecreasing time order. */
type IUndoNode = {
  txId: string
  seq: number
  time: number
  images: readonly IUndoImage[]
  previous?: IUndoNode
  next?: IUndoNode
}
/** Projects only owned undo fields after the shared JSON snapshot has excluded accessors. */
function undoPayload(
  value: ILogPayload,
  recovering = true
): { txId: string; images: readonly IUndoImage[] } {
  const fail = (): never => {
    if (recovering) throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt)
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const record = value as Record<string, ILogPayload>
  if (typeof record.txId !== 'string' || record.txId.length === 0 || !Array.isArray(record.images))
    return fail()
  const images: IUndoImage[] = []
  for (const value of record.images) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
    for (const key of ['target', 'before', 'after']) if (!Object.hasOwn(value, key)) return fail()
    const image = value as Record<string, ILogPayload>
    images.push({ target: image.target, before: image.before, after: image.after })
  }
  return { txId: record.txId, images }
}
/** Stores undo images without acquiring authority to commit, roll back, or apply business values. */
export function undoLog(options: IDurablePluginOptions): IDurablePlugin<IUndoLogExt> {
  options = captureDurableOptions(options)
  return {
    name: UNDO_PLUGIN_NAME,
    config: {},
    install: (core) => {
      const index = new Map<string, IUndoNode>()
      const bySeq = new Map<number, IUndoNode>()
      let tail: IUndoNode | undefined
      /** Reservations only represent this installation's currently staged transaction identities. */
      const reservations = new Map<string, object>()
      /** Source progress counts committed sequence numbers, independent of plugin callbacks. */
      let cursor = 0
      let notified = 0
      let runtime: IDurableRuntime
      const accept = (record: ILogRecord): void => {
        if (record.kind !== DurableKind.undo || bySeq.has(record.seq)) return
        const payload = undoPayload(record.payload)
        if (index.has(payload.txId))
          throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt)
        const node: IUndoNode = { ...payload, seq: record.seq, time: record.time, previous: tail }
        if (tail) tail.next = node
        tail = node
        index.set(node.txId, node)
        bySeq.set(node.seq, node)
      }
      const synchronize = async (): Promise<void> => {
        while (cursor < notified) {
          const records = await options.store.read(cursor + 1, 128)
          if (records.length === 0) {
            cursor = notified
            break
          }
          for (const record of records) {
            if (record.seq > notified) break
            accept(record)
            cursor = record.seq
          }
        }
      }
      runtime = createDurableRuntime(core, options, DurableKind.undo, async () => {
        const off = options.store.onAppend((notice) => {
          notified = Math.max(notified, notice.lastSeq)
          void runtime.run(LogOperation.read, synchronize).catch(() => runtime.stop())
        })
        runtime.cleanups.add(off)
        runtime.cleanups.add(() => {
          reservations.clear()
        })
        const high = await options.store.lastSeq()
        for (const seq of await options.store.states(LogRecordState.pending)) {
          if (seq > high) break
          const record = (await options.store.read(seq, 1))[0]
          if (record?.seq === seq) accept(record)
        }
        cursor = high
        notified = Math.max(notified, high)
      })
      runtime.afterIdle.add(() => {
        index.clear()
        bySeq.clear()
        reservations.clear()
        tail = undefined
      })
      /**
       * Same-sequence replay from a notification is idempotent; different active duplicates are
       * corrupt.
       */
      const publish = async (seqs: readonly number[]): Promise<void> => {
        for (const seq of seqs) {
          const record = (await options.store.read(seq, 1))[0]
          if (record?.seq === seq) accept(record)
        }
      }
      const api: IUndoLogExt['undo'] = {
        ready: runtime.ready,
        whenIdle: runtime.whenIdle,
        record: (txId, images, appendOptions) => {
          let payload: ILogPayload
          let port: import('./types.js').ILogAppendPort | undefined
          try {
            runtime.admit()
            requireText(txId)
            payload = snapshotPayload({ txId, images })
            undoPayload(payload, false)
            port = captureAppendPort(appendOptions)
          } catch (error) {
            return Promise.reject(error)
          }
          const check = (): void => {
            if (index.has(txId) || reservations.has(txId))
              throw createLoggerError(LoggerErrorCode.undoRecordExists, DurableText.undoExists)
          }
          if (port) {
            try {
              check()
            } catch (error) {
              return Promise.reject(error)
            }
            const identity = {}
            reservations.set(txId, identity)
            const release = (): void => {
              if (reservations.get(txId) === identity) reservations.delete(txId)
            }
            const result = runtime.appendPort(
              port,
              [{ kind: DurableKind.undo, payload }],
              () => {
                void runtime
                  .run(LogOperation.read, async () => {
                    await synchronize()
                    release()
                  })
                  .catch(runtime.report)
              },
              release
            )
            void result.catch(release)
            return result.then(() => undefined)
          }
          return runtime.run(LogOperation.record, async () => {
            await synchronize()
            check()
            const seqs = await options.store.append([{ kind: DurableKind.undo, payload }])
            await publish(seqs)
          })
        },
        get: (txId) => {
          try {
            requireText(txId)
          } catch (error) {
            return Promise.reject(error)
          }
          return runtime.run(LogOperation.get, async () => {
            await synchronize()
            const node = index.get(txId)
            return node ? (snapshotPayload(node.images) as readonly IUndoImage[]) : undefined
          })
        },
        list: (listOptions) => {
          let limit: number
          let sinceTime: number
          try {
            ;({ limit, sinceTime } = captureUndoListOptions(listOptions))
          } catch (error) {
            return Promise.reject(error)
          }
          return runtime.run(LogOperation.list, async () => {
            await synchronize()
            const result: { txId: string; time: number }[] = []
            for (
              let node = tail;
              node && result.length < limit && node.time >= sinceTime;
              node = node.previous
            )
              result.push({ txId: node.txId, time: node.time })
            return result
          })
        },
        forget: (txId) => {
          try {
            requireText(txId)
          } catch (error) {
            return Promise.reject(error)
          }
          return runtime.run(LogOperation.forget, async () => {
            await synchronize()
            const node = index.get(txId)
            if (!node) return
            await options.store.setState(node.seq, LogRecordState.done)
            if (node.previous) node.previous.next = node.next
            if (node.next) node.next.previous = node.previous
            else tail = node.previous
            index.delete(txId)
            bySeq.delete(node.seq)
          })
        }
      }
      return { undo: api }
    }
  }
}
