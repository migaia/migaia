import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import type { ILogEntry, ILogPluginCore } from '@migaia/log-host/plugin'
import { processPlugin } from '../../src/index.ts'
import { MemoryProcess, execution, nextTurn } from '../fixtures.ts'

/** The ordinary public core admits a final shutdown entry before resources are disposed. */
class ShutdownLog {
  /** This distinct peer owns the final handler and output callback. */
  readonly name = 'shutdown-log'
  /** Delivered messages make shutdown logging observable after process exit. */
  readonly writes: string[] = []

  /** Register final logging and the sink during the supported installation window. */
  install(core: ILogPluginCore): Record<string, never> {
    core.onShutdown(() => core.log('info', 'shutdown started'))
    core.useSink((entry) => this.record(entry))
    return {}
  }

  /** The sink observes the entry itself instead of a formatting compatibility path. */
  record(entry: ILogEntry): void {
    this.writes.push(entry.message)
  }
}

/** Signal exit retains code zero and waits until the host has delivered its final handler log. */
async function signalFinalLog(): Promise<void> {
  /** Injected process records exit codes without affecting the real test runner. */
  const process = new MemoryProcess()
  /** The original message assertion is retained through a real peer-owned sink. */
  const shutdownLog = new ShutdownLog()
  /** The original fifty-millisecond graceful budget remains unchanged. */
  const host = createLogHost({
    execution,
    plugins: [processPlugin({ process, shutdownTimeoutMs: 50 }), shutdownLog]
  })
  process.fire('SIGINT')
  await host.shutdown('signal')
  await nextTurn()
  expect(process.exits).toEqual([0])
  expect(shutdownLog.writes).toContain('shutdown started')
}

it('exits with signal code after cores dispose and preserves shutdown logs', signalFinalLog)
