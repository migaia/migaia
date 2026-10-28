import { detectServerRuntime } from '@migaia/utils'
import type { IConsoleProcess } from './typing.ts'

/** Capture only a recognized server's process capability; browser-like hosts can omit it. */
export function consoleProcess(): IConsoleProcess | undefined {
  if (detectServerRuntime() === undefined) return undefined
  return (globalThis as unknown as { process?: IConsoleProcess }).process
}
