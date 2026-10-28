import type { ILogFeature } from '@migaia/log-host/plugin'

/** Borrowed file operations need no Node, Bun or Deno-specific public type declarations. */
export type IFileWriter = {
  append(path: string, text: string): Promise<void>
  rotate?(path: string): Promise<void>
}

/** NDJSON delivery delegates all buffering and delivery policy to host features. */
export type IFilePluginConfig = {
  /** Required nonempty destination passed unchanged to the borrowed append capability. */
  readonly path: string
  /** Defaults to a supported runtime's native append writer in server conditions only. */
  readonly writer?: IFileWriter
  /** Optional per-delivered-batch thresholds require an explicit rotate capability. */
  readonly rotate?: {
    /** Rotate after a batch reaches the specified UTF-8 byte count. */
    readonly maxBytes?: number
    /** Rotate after a batch reaches the specified entry count. */
    readonly maxEntries?: number
  }
  /** Host-owned output policies override host defaults without creating a private queue. */
  readonly features?: readonly ILogFeature[]
}
