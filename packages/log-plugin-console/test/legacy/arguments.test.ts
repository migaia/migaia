import { expect, it } from 'vitest'
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { formatFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '../../src/index.ts'
import { MemoryConsole, MemoryStdout } from '../fixtures.ts'

/** The standard severity extension preserves console-style nonstring first arguments. */
async function nonStringArgument(): Promise<void> {
  /** Native argument lists remain separate in the borrowed console. */
  const console = new MemoryConsole()
  /** Output formatting never coerces the original object argument. */
  const logger = createLogHost({
    plugins: [
      levelPlugin(),
      consolePlugin({
        console,
        stdout: new MemoryStdout(),
        features: [prettyFeature({ color: 'never', timestamp: false })]
      })
    ]
  })
  /** The original application object must retain its exact identity. */
  const value = { answer: 42 }
  logger.info(value, 'tail')
  await logger.flush()
  expect(console.logs[0]).toEqual([expect.stringContaining('[INFO]'), value, 'tail'])
  expect(console.logs[0][1]).toBe(value)
  await logger.shutdown('manual')
}
it('accepts a non-string first argument like console.log', nonStringArgument)

/** Pretty output keeps all primitive arguments in their original order beside message placeholders. */
async function consoleStyleArguments(): Promise<void> {
  /** The observer records native values without applying terminal substitutions. */
  const console = new MemoryConsole()
  /** Forced ANSI affects only the format's own display values. */
  const logger = createLogHost({
    plugins: [
      levelPlugin(),
      consolePlugin({ console, features: [prettyFeature({ color: 'always', timestamp: false })] })
    ]
  })
  logger.info('value: %s', 42, true, null)
  await logger.flush()
  expect(console.logs[0]).toEqual([expect.stringContaining('value: %s'), 42, true, null])
  await logger.shutdown('manual')
}
it('renders all console-style arguments in their original native order', consoleStyleArguments)

/** A method-owned observer proves JSON delivery supplies the original console receiver. */
class ReceiverConsole {
  /** The argument lists are retained independently of receiver assertions. */
  readonly calls: unknown[][] = []
  /** A detached invocation would fail when reading this instance-owned field. */
  log(...args: unknown[]): void {
    this.calls.push(args)
  }
  /** Warning and error routes preserve the same borrowed receiver semantics. */
  warn(...args: unknown[]): void {
    this.calls.push(args)
  }
  /** Error routing stays a method call on the original console object. */
  error(...args: unknown[]): void {
    this.calls.push(args)
  }
}

/** Structured JSON keeps its original arguments and business data while output remains asynchronous. */
async function structuredFields(): Promise<void> {
  /** The original custom console is borrowed directly by the production output. */
  const console = new ReceiverConsole()
  /** JSON is an explicit host-owned feature instead of an old color-plugin option. */
  const logger = createLogHost({
    plugins: [consolePlugin({ console })],
    features: [formatFeature({ format: 'json' })]
  })
  logger.dispatchRaw({ tag: 'info', message: 'user=%s', args: ['alice'], data: { tenant: 'acme' } })
  await logger.flush()
  /** The exact original field assertions remain independent of prefix formatting. */
  const payload = JSON.parse(String(console.calls[0]?.[0]))
  expect(payload.id).toMatch(/^log_/)
  expect(payload.args).toEqual(['alice'])
  expect(payload.data).toEqual({ tenant: 'acme' })
  await logger.shutdown('manual')
}
it('preserves structured JSON fields and invokes a custom console with its owner', structuredFields)
