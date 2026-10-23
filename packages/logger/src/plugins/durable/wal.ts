import { captureDurableOptions, createDurableRuntime } from './plugin-runtime.js'
import { assertLogInteger } from './committed-index.js'
import { snapshotLogRecords } from './snapshot.js'
import { DurableKind, LogOperation, LogRecordState, LogStage } from './state-constants.js'
import type { IDurablePlugin, IDurablePluginOptions, ILogRecord, IWalExt } from './types.js'

/** Records durable intent before business work and only permits terminal state transitions. */
export function wal(options: IDurablePluginOptions): IDurablePlugin<IWalExt> {
  options = captureDurableOptions(options)
  return {
    name: DurableKind.wal,
    config: {},
    install: (core) => {
      const runtime = createDurableRuntime(core, options, DurableKind.wal)
      return {
        wal: {
          ready: runtime.ready,
          whenIdle: runtime.whenIdle,
          begin: (kind, payload) => {
            let captured: ReturnType<typeof snapshotLogRecords>
            try {
              runtime.admit()
              captured = snapshotLogRecords([{ kind, payload }])
            } catch (error) {
              return Promise.reject(error)
            }
            return runtime.run(LogOperation.begin, async () => {
              const [seq] = await runtime.store.append(captured)
              runtime.observe(() => ({
                stage: LogStage.onWalPending,
                owner: DurableKind.wal,
                operation: LogOperation.begin,
                seq
              }))
              return seq
            })
          },
          complete: (seq) => {
            try {
              assertLogInteger(seq)
            } catch (error) {
              return Promise.reject(error)
            }
            return runtime.run(LogOperation.complete, () =>
              runtime.store.setState(seq, LogRecordState.done)
            )
          },
          abort: (seq) => {
            try {
              assertLogInteger(seq)
            } catch (error) {
              return Promise.reject(error)
            }
            return runtime.run(LogOperation.abort, () =>
              runtime.store.setState(seq, LogRecordState.aborted)
            )
          },
          pending: () =>
            runtime.run(LogOperation.pending, async () => {
              const records: ILogRecord[] = []
              for (const seq of await runtime.store.states(LogRecordState.pending)) {
                const record = (await runtime.store.read(seq, 1))[0]
                if (record?.seq === seq) records.push(record)
              }
              return records
            })
        }
      }
    }
  }
}
