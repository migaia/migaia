import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'

/** Display policy separate from UUID generation and entry identity. */
export type IUuidPluginConfig = {
  /**
   * Shows the UUID in rendered output, such as the pretty prefix or the JSON `uuid` field. Defaults
   * to `false`. The plugin always writes the UUID to `entry.data.uuid`, regardless of display
   * settings. HTTP and batch sinks can still use it for tracing or deduplication when rendered
   * display is disabled.
   */
  display?: boolean
}

/** Stable registration/config key for per-entry UUID enrichment. */
export const UUID_PLUGIN_NAME = 'uuid' as const

/** UUID generation is delegated to runtime-manager so browser fallbacks and test runtimes work. */
class UuidPlugin implements ILoggerPlugin<IEmptyPluginExt, IUuidPluginConfig> {
  readonly name = UUID_PLUGIN_NAME
  readonly config: IUuidPluginConfig

  constructor(config: IUuidPluginConfig) {
    this.config = config
  }

  install(core: ILoggerPluginCore): IEmptyPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取
    const config = core.config.get<IUuidPluginConfig>() ?? {}
    const display = config.display ?? false

    core.usePipeline((entry, next) => {
      // entry 按约定不可变，"修改"的方式是构造一个新对象传给 next，
      // 只在 data 里追加 uuid 相关字段，其它字段原样透传
      next({
        ...entry,
        data: { ...entry.data, uuid: core.runtimeManager.randomUUID(), uuidDisplay: display }
      })
    })

    return {}
  }
}

/**
 * Create a pipeline enricher using the captured runtime randomUUID capability for entry.data.uuid.
 * Display defaults to false but generation still occurs; the core id remains separately generated.
 * Plugin removal revokes its stage without taking ownership of the borrowed identity generator.
 */
export const uuid = (
  config: IUuidPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IUuidPluginConfig> => new UuidPlugin(config)
