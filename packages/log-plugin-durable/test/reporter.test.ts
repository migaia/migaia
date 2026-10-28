import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import * as host from '@migaia/log-host'
import { memoryLogStore } from '../src/index.ts'
import { fileLogStore } from '../src/file.ts'

/** One original observer failure is reused to prove identity at the actual default boundary. */
const observerError = new Error('durable observer fixture')
/** An observer can fail synchronously despite its diagnostic-only role. */
function failObserver(): never {
  throw observerError
}
/** A diagnostic observer can also return a rejected thenable despite a void type. */
function rejectObserver(): Promise<void> {
  return Promise.reject(observerError)
}
/** A broken custom reporter must fall back once to the same host-owned terminal reporter. */
function failReporter(): never {
  throw observerError
}
/** A custom reporter's rejected completion reaches the same terminal fallback. */
function rejectReporter(): Promise<void> {
  return Promise.reject(observerError)
}
/** Terminal failure must stop after itself without escaping to a host exception. */
function failTerminal(): never {
  throw new Error('terminal fixture')
}
/** The original native I/O error must remain reachable despite concurrent diagnostic failures. */
const ioError = new Error('native close I/O fixture')
/** Fail the actual native close boundary while leaving the original connection available to cleanup. */
function failNativeClose(): never {
  throw ioError
}

/** Standalone memory stores use the exact module-bound host reporter, with a custom fallback. */
async function memoryReporter(): Promise<void> {
  /** Spy the actual root export used by the durable implementation. */
  const terminal = vi.spyOn(host, 'defaultLogFailureReporter').mockImplementation(() => undefined)
  try {
    /** The constructor's observer error reaches the same shared reporter. */
    const first = memoryLogStore({ observe: failObserver })
    expect(terminal).toHaveBeenCalledWith(observerError)
    await first.dispose()
    terminal.mockClear()
    /** Explicit diagnostics replace the default for successful reporting. */
    const custom = vi.fn()
    const second = memoryLogStore({ observe: rejectObserver, report: custom })
    await second.append([{ kind: 'saved', payload: null }])
    expect(custom).toHaveBeenCalledWith(observerError)
    expect(terminal).not.toHaveBeenCalled()
    await second.dispose()
    /** Rejected custom diagnostics also fall back without changing the committed storage result. */
    const rejected = memoryLogStore({ observe: failObserver, report: rejectReporter })
    await expect(rejected.append([{ kind: 'saved', payload: null }])).resolves.toEqual([1])
    expect(terminal).toHaveBeenCalledWith(observerError)
    await rejected.dispose()
    /** Custom reporter failure invokes the same default, whose own failure then stops. */
    terminal.mockImplementation(failTerminal)
    const third = memoryLogStore({ observe: failObserver, report: failReporter })
    await expect(third.append([{ kind: 'saved', payload: null }])).resolves.toEqual([1])
    await expect(
      third.append([{ kind: 'bad', payload: undefined }] as never)
    ).rejects.toMatchObject({ source: 'logging.durable', code: 'LOG_PAYLOAD_INVALID' })
    await third.dispose()
    /** A terminal rejected completion is also observed without recursive reporting. */
    terminal.mockImplementation(rejectReporter)
    const rejectedTerminal = memoryLogStore({ observe: failObserver, report: failReporter })
    await expect(rejectedTerminal.append([{ kind: 'saved', payload: null }])).resolves.toEqual([1])
    await rejectedTerminal.dispose()
  } finally {
    terminal.mockRestore()
  }
}

/** A real file store has the same default reporter without acquiring a log host instance. */
async function fileReporter(): Promise<void> {
  /** The fixture owns the native file resource and its temporary directory. */
  const directory = await mkdtemp(join(tmpdir(), 'durable-reporter-'))
  /** Observe the canonical imported default without replacing storage or its native driver. */
  const terminal = vi.spyOn(host, 'defaultLogFailureReporter').mockImplementation(() => undefined)
  try {
    /** The custom reporter still receives the original coded storage failure before it rejects. */
    const customReport = vi.fn(rejectReporter)
    /** Native resource creation must remain usable even if its optional observer rejects. */
    const store = await fileLogStore(join(directory, 'records.sqlite'), {
      observe: rejectObserver,
      report: customReport
    })
    await store.append([{ kind: 'saved', payload: null }])
    expect(terminal).toHaveBeenCalledWith(observerError)
    /** Inject a real driver-boundary failure without replacing the store or its persistence owner. */
    const close = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(failNativeClose)
    try {
      await expect(store.dispose()).rejects.toMatchObject({
        source: 'logging.durable',
        code: 'LOG_STORE_IO_FAILED',
        cause: ioError
      })
      await expect(store[Symbol.asyncDispose]()).resolves.toBeUndefined()
      expect(customReport).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'logging.durable',
          code: 'LOG_STORE_IO_FAILED',
          cause: ioError
        })
      )
      expect(terminal).toHaveBeenCalledWith(observerError)
    } finally {
      /** The fixture releases its real native connection after restoring the original driver. */
      const database = close.mock.contexts[0] as DatabaseSync | undefined
      close.mockRestore()
      database?.close()
    }
  } finally {
    terminal.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
}

it('uses the shared default and contains custom and terminal reporter failures', memoryReporter)
it('uses the same host reporter for a standalone native file store', fileReporter)
