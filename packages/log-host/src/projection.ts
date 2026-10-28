import { serializeErrorChain } from '@migaia/utils/error'
import type { ILogEntry, ILogProjectedEntry } from './typing.ts'
import { LogEntryDataKey } from './state-constants.ts'

/** Replace only error projection; native raw identity stays on the original entry. */
export function projectLogEntry(entry: ILogEntry): ILogProjectedEntry {
  return { ...entry, error: entry.error ? serializeErrorChain(entry.error.raw) : undefined }
}

/** Plain output uses the established uncolored prefix and writer argument text. */
export function plainLogEntry(entry: ILogEntry): string {
  /** Stable fields match the former uncolored console writer path. */
  const prefix = `[${entry.time.toISOString()}] [${entry.tag.toUpperCase()}] ${entry.data.uuidDisplay ? `{${entry.data.uuid}} ` : ''}${entry.context.length ? `(${entry.context.join('.')}) ` : ''}`
  /** Display topics remain public data; forwarding authority is never serialized. */
  const chain = entry.data[LogEntryDataKey.topicChain] as readonly string[] | undefined
  /** One final join avoids repeated copying of growable argument text. */
  const parts: unknown[] = [
    `${prefix}${chain?.length ? `[${chain.join(' -> ')}]: ` : ''}${entry.message}`,
    ...entry.args
  ]
  if (entry.meta && !entry.args.includes(entry.meta)) parts.push(entry.meta)
  if (entry.error) parts.push(entry.error.raw)
  return parts.map(String).join(' ')
}
