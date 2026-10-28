import { expect, it } from 'vitest'
import { createLogHost, LogHostStatus } from '@migaia/log-host'
import { processPlugin } from '../src/index.ts'

import { MemoryProcess } from './fixtures.ts'

/** Same-object installations share listeners; distinct process objects remain independent. */
async function groupedProcesses(): Promise<void> {
  /** First process is shared by two independent log hosts. */
  const first = new MemoryProcess()
  /** Second process is an independent lifecycle domain. */
  const second = new MemoryProcess()
  /** Two hosts borrow the same process without doubling any event subscription. */
  const one = createLogHost({ plugins: [processPlugin({ process: first })] })
  /** A second process does not trigger the removed global-object conflict. */
  const two = createLogHost({ plugins: [processPlugin({ process: second })] })
  /** The final shared installation reuses the first process's group. */
  const three = createLogHost({ plugins: [processPlugin({ process: first })] })
  expect(first.listeners.size).toBe(5)
  for (const listeners of first.listeners.values()) expect(listeners.size).toBe(1)
  for (const listeners of second.listeners.values()) expect(listeners.size).toBe(1)
  first.fire('SIGTERM')
  // Sixty-four microtasks are a fixed bound for the hosts' asynchronous terminal phases.
  for (let index = 0; index < 64; index++) await Promise.resolve()
  expect(one.status).toBe(LogHostStatus.closed)
  expect(three.status).toBe(LogHostStatus.closed)
  expect(two.status).toBe(LogHostStatus.active)
  for (const listeners of first.listeners.values()) expect(listeners.size).toBe(0)
  expect(first.exits).toEqual([0])
  await two.shutdown('manual')
  for (const listeners of second.listeners.values()) expect(listeners.size).toBe(0)
}
it('shares listeners by process object and isolates independent signal groups', groupedProcesses)
