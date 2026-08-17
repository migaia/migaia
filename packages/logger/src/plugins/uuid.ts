import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing.js';
import { getLoggerRuntimeManager } from '../runtime-manager.js';

export type IUuidPluginConfig = {
  /**
   * 是否让 uuid 跟着日志一起出现在渲染出来的输出里（控制台 pretty 格式的前缀、 JSON 格式里的 id 字段），默认 false。 注意：不管这个开关是否打开，uuid
   * 本身始终会写入 entry.data.uuid —— 关掉的只是"要不要显示"，不影响 http/batch 这类下游 sink 拿到它用于 链路追踪/去重，这两件事是独立的。
   */
  display?: boolean;
};

export const UUID_PLUGIN_NAME = 'uuid' as const;

/** UUID generation is delegated to runtime-manager so browser fallbacks and test runtimes work. */
class UuidPlugin implements ILoggerPlugin<IEmptyPluginExt, IUuidPluginConfig> {
  readonly name = UUID_PLUGIN_NAME;
  readonly config: IUuidPluginConfig;

  constructor(config: IUuidPluginConfig) {
    this.config = config;
  }

  install(core: ILoggerPluginCore): IEmptyPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取
    const config = core.config.get<IUuidPluginConfig>() ?? {};
    const display = config.display ?? false;

    core.usePipeline((entry, next) => {
      // entry 按约定不可变，"修改"的方式是构造一个新对象传给 next，
      // 只在 data 里追加 uuid 相关字段，其它字段原样透传
      next({
        ...entry,
        data: { ...entry.data, uuid: getLoggerRuntimeManager().randomUUID(), uuidDisplay: display }
      });
    });

    return {};
  }
}

export const uuid = (
  config: IUuidPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IUuidPluginConfig> => new UuidPlugin(config);
