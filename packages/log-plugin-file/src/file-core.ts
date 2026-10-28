import { attachErrorIdentity } from '@migaia/utils/error'
import { defineOutputPlugin, type ILogOutputRecord, type ILogPlugin } from '@migaia/log-host/plugin'
import { ERROR_SOURCE, LogFileErrorCode, type ILogFileErrorCode } from './error-code.ts'
import { LogFileErrorText } from './error-text.ts'
import type { IFilePluginConfig, IFileWriter } from './typing.ts'

/** Stable registration identity is shared by server and portable condition entries. */
const FILE_PLUGIN_NAME = 'file'

/** Attach local identity to the existing native wrapper while preserving the exact cause. */
function fileError(code: ILogFileErrorCode, text: string, cause?: unknown): Error {
  return attachErrorIdentity(new Error(text, cause === undefined ? undefined : { cause }), {
    source: ERROR_SOURCE,
    code
  })
}

/** One file output appends only the host-formatted batch and optional explicit rotation. */
class FileOutput {
  /** Destination is captured before installation can observe caller mutation. */
  #path: string
  /** A writer is borrowed; removing this output never closes an application-owned capability. */
  #writer: IFileWriter
  /** Rotation is evaluated per delivered batch, preserving the previous counting boundary. */
  #rotate: IFilePluginConfig['rotate']

  /** Validate path, thresholds and required capabilities synchronously before publication. */
  constructor(options: IFilePluginConfig, defaultWriter?: IFileWriter) {
    if (typeof options.path !== 'string' || options.path.length === 0)
      throw fileError(LogFileErrorCode.invalidOption, LogFileErrorText.invalidOption)
    this.#path = options.path
    this.#rotate = options.rotate ? { ...options.rotate } : undefined
    for (const threshold of [this.#rotate?.maxBytes, this.#rotate?.maxEntries]) {
      // Exactly two compile-time threshold keys are validated, independent of the batch size.
      if (threshold !== undefined && (!Number.isSafeInteger(threshold) || threshold < 1))
        throw fileError(LogFileErrorCode.invalidOption, LogFileErrorText.invalidOption)
    }
    /** A portable/browser condition never supplies a hidden filesystem fallback. */
    const writer = options.writer ?? defaultWriter
    if (!writer) throw fileError(LogFileErrorCode.fileSinkUnavailable, LogFileErrorText.unavailable)
    if (
      (this.#rotate?.maxBytes !== undefined || this.#rotate?.maxEntries !== undefined) &&
      typeof writer.rotate !== 'function'
    )
      throw fileError(LogFileErrorCode.invalidOption, LogFileErrorText.invalidOption)
    this.#writer = writer
  }

  /** Join once, append once and rotate only after a successful triggering batch. */
  async deliver(records: readonly ILogOutputRecord[]): Promise<void> {
    try {
      /** Formatting, including shared JSON error projection, has already run in the host. */
      const text = `${records.map(recordText).join('\n')}\n`
      await this.#writer.append(this.#path, text)
      if (
        (this.#rotate?.maxEntries !== undefined && records.length >= this.#rotate.maxEntries) ||
        (this.#rotate?.maxBytes !== undefined &&
          new TextEncoder().encode(text).length >= this.#rotate.maxBytes)
      )
        await this.#writer.rotate!(this.#path)
    } catch (cause) {
      throw fileError(LogFileErrorCode.deliveryFailed, LogFileErrorText.writeFailed, cause)
    }
  }
}

/** Select already-formatted text rather than introducing another file-owned serialization path. */
function recordText(record: ILogOutputRecord): string {
  return record.text
}

/** Condition entries provide only their supported default capability to the same file owner. */
export function createFilePlugin(
  options: IFilePluginConfig,
  defaultWriter?: IFileWriter
): ILogPlugin {
  /** Named state owns the writer; the SDK callback only forwards the batch. */
  const output = new FileOutput(options, defaultWriter)
  return defineOutputPlugin({
    name: FILE_PLUGIN_NAME,
    batchable: true,
    defaultFormat: 'json',
    features: options.features,
    deliver: (records) => output.deliver(records)
  })
}
