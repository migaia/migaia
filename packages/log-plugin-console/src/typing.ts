import type { ILogFeature } from '@migaia/log-host/plugin'
import type { ConsoleColorMode } from './state-constants.ts'

/** Borrowed console methods keep their receiver and native argument identity. */
export type IConsoleTarget = {
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Raw text and terminal detection belong to the selected output capability. */
export type IConsoleStdout = { readonly isTTY?: boolean; write(text: string): unknown }

/** Plugin options borrow capabilities without taking ownership of their lifetime. */
export type IConsoleOptions = {
  console?: IConsoleTarget
  stdout?: IConsoleStdout
  features?: readonly ILogFeature[]
}

/** Pretty policy is independent of the console output transport. */
export type IPrettyOptions = { color?: ConsoleColorMode; timestamp?: boolean }

/** Only these structural process fields are needed; Node type declarations are not exposed. */
export type IConsoleProcess = {
  readonly env?: Record<string, string | undefined>
  readonly stdout?: IConsoleStdout
}

/** The console-owned raw extension is synchronous and contains writer failures. */
export type IConsoleExtension = { raw(text: string): void }
