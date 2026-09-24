import { defineFeature, type IPipelineMode } from '@migaia/plugin-host'
import { createLoggerError, LoggerErrorCode } from '../errors.js'
import { LoggerErrorText } from '../error-text.js'
import { getLoggerRuntimeManager, type ILoggerRuntimeManager } from '../runtime-manager.js'
import type { IEmptyPluginExt, ILogEntry, ILoggerPlugin, ILoggerPluginCore } from '../typing.js'
import {
  createBatcherForCore,
  optionalBatchFeature,
  type IBatchController,
  type IBatchPluginConfig,
  type IBatchShared
} from './batch.js'

export type IFilePluginConfig = {
  readonly path: string
  readonly batch?: IBatchPluginConfig
  /** Per-batch rotation threshold; injected fs supplies the rotation operation. */
  readonly rotate?: { readonly maxBytes?: number; readonly maxEntries?: number }
}

export const FILE_PLUGIN_NAME = 'file' as const

/** Optional batch output resolved once for one file registration. */
type IFileFeatureDependencies = Readonly<{ readonly batch: IBatchShared | undefined }>

/** Bridges the batch provider reference into file installation. */
const fileDependenciesFeature = defineFeature<
  Record<never, never>,
  { readonly batch: typeof optionalBatchFeature },
  IFileFeatureDependencies
>((_core, dependencies) => ({ batch: dependencies.batch }), { batch: optionalBatchFeature })

/** Builds the file plugin around the shared batch owner and an optional platform default sink. */
export const createFilePlugin = (
  config: IFilePluginConfig,
  defaultSink?: () => NonNullable<ILoggerRuntimeManager['fs']>
): ILoggerPlugin<
  IEmptyPluginExt,
  IFilePluginConfig,
  IPipelineMode,
  { readonly dependencies: typeof fileDependenciesFeature }
> => {
  if (typeof config.path !== 'string' || config.path.length === 0)
    throw createLoggerError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidOption)
  for (const threshold of [config.rotate?.maxBytes, config.rotate?.maxEntries]) {
    if (threshold !== undefined && (!Number.isSafeInteger(threshold) || threshold < 1))
      throw createLoggerError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidOption)
  }
  return {
    name: FILE_PLUGIN_NAME,
    config,
    features: Object.freeze({ dependencies: fileDependenciesFeature }),
    install: (
      core: ILoggerPluginCore<IPipelineMode> &
        Readonly<{ readonly features: { readonly dependencies: IFileFeatureDependencies } }>
    ) => {
      const resolved = core.config.get<IFilePluginConfig>() ?? config
      const fs = getLoggerRuntimeManager().fs ?? defaultSink?.()
      if (!fs)
        throw createLoggerError(
          LoggerErrorCode.fileSinkUnavailable,
          LoggerErrorText.fileSinkUnavailable
        )
      /** Sends one existing batch as newline-delimited JSON without changing dispatch timing. */
      const write = async (entries: ILogEntry[]): Promise<void> => {
        try {
          const text = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
          await fs.append(resolved.path, text)
          if (
            (resolved.rotate?.maxEntries !== undefined &&
              entries.length >= resolved.rotate.maxEntries) ||
            (resolved.rotate?.maxBytes !== undefined &&
              new TextEncoder().encode(text).length >= resolved.rotate.maxBytes)
          )
            await fs.rotate?.(resolved.path)
        } catch (error) {
          throw createLoggerError(LoggerErrorCode.deliveryFailed, LoggerErrorText.fileWriteFailed, {
            cause: error
          })
        }
      }
      const createBatcher = core.features.dependencies.batch?.createBatcher
      const batcher: IBatchController<ILogEntry> = createBatcher
        ? (createBatcher<ILogEntry>(resolved.batch ?? {}, write) as IBatchController<ILogEntry>)
        : createBatcherForCore(core, {}, resolved.batch ?? {}, write, false)
      core.onDispose(async () => {
        const errors = await batcher.dispose()
        if (errors.length > 0) throw errors[0]
      })
      core.onDispose(core.useSink((entry) => batcher.push(entry)))
      return {}
    }
  }
}
