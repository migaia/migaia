import type { ILogEntry, ILogContext, IRawEntryInput } from './typing.ts'
import { LogEntryText } from './state-constants.ts'

/** Entry sequence stays host-family owned, independently of optional display UUID enrichment. */
let entrySequence = 0
/** Host defaults and issued UUID stage descriptors share the same native generation capability. */
export function defaultRandomUUID(): string {
  return globalThis.crypto.randomUUID()
}
/** Synchronously capture caller-owned top-level containers before asynchronous admission. */
export function buildLogEntry(input: IRawEntryInput, context: ILogContext): ILogEntry {
  /** Native Error objects stay shared; only their descriptive envelope is copied. */
  const args = [...(input.args ?? [])]
  /** The first native argument is projected only when no explicit error was supplied. */
  const errorArgument = input.error
    ? undefined
    : args.find((value): value is Error => value instanceof Error)
  return {
    id: LogEntryText.id(++entrySequence),
    tag: input.tag,
    time: new Date(input.time?.getTime() ?? Date.now()),
    message: input.message,
    args,
    meta: input.meta ? { ...input.meta } : undefined,
    context: [...(input.context ?? context.path)],
    error:
      input.error ??
      (errorArgument
        ? {
            name: errorArgument.name,
            message: errorArgument.message,
            stack: errorArgument.stack,
            raw: errorArgument
          }
        : undefined),
    data: { ...input.data }
  }
}
/**
 * Each sink receives independent shallow containers, preserving nested payload/native error
 * identity.
 */
export function snapshotLogEntry(entry: ILogEntry): ILogEntry {
  return {
    ...entry,
    time: new Date(entry.time.getTime()),
    args: [...entry.args],
    meta: entry.meta ? { ...entry.meta } : undefined,
    context: [...entry.context],
    error: entry.error ? { ...entry.error } : undefined,
    data: { ...entry.data }
  }
}
