import process from 'node:process'
import { fileLogStore } from '@migaia/log-plugin-durable/file'
import { LogRecordState } from '@migaia/log-plugin-durable'

/** Separate processes prove actual runtime loading, lock ownership, and committed reopening. */
const [mode, path] = process.argv.slice(2)
if (mode === 'verify') {
  let store = await fileLogStore(path)
  await store.append(
    Array.from({ length: 10 }, (_, index) => ({ kind: 'runtime', payload: { index } }))
  )
  await store.setState(1, LogRecordState.done)
  await store.dispose()
  store = await fileLogStore(path)
  const records = await store.read(1, 100)
  const pending = await store.states(LogRecordState.pending)
  const [next] = await store.append([{ kind: 'runtime', payload: null }])
  await store.dispose()
  if (records.length !== 10 || next !== 11 || pending.length !== 9) process.exit(1)
  console.log(JSON.stringify({ records: records.length, next, pending: pending.length }))
} else if (mode === 'locked') {
  try {
    const store = await fileLogStore(path)
    await store.dispose()
    process.exitCode = 1
  } catch (error) {
    console.log(JSON.stringify({ code: (error as { code: unknown }).code }))
    if ((error as { code: unknown }).code !== 'LOG_STORE_LOCKED') process.exitCode = 1
  }
} else if (mode === 'crash-committed') {
  const store = await fileLogStore(path)
  await store.append(Array.from({ length: 3 }, () => ({ kind: 'committed', payload: null })))
  process.kill(process.pid, 'SIGKILL')
} else if (mode === 'crash-batch') {
  const store = await fileLogStore(path)
  console.log('ready')
  await store.append(Array.from({ length: 10000 }, () => ({ kind: 'batch', payload: null })))
  console.log('committed')
  await new Promise(() => undefined)
}
