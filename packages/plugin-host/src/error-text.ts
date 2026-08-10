import type { IPluginHostErrorCode } from './typing';

export type ILocaleKey = 'en' | 'zh';

export class PluginHostError extends Error {
  readonly code: IPluginHostErrorCode;
  constructor(code: IPluginHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PluginHostError';
    this.code = code;
  }
}

const PREFIX = '[plugin-host] ';
let localeKey: ILocaleKey = 'zh';

/** 设置 PluginHost 全局错误语言。 */
export const setErrorLocale = (nextLocale: ILocaleKey): void => {
  localeKey = nextLocale;
};

const localize = (zh: string, en: string): string => `${PREFIX}${localeKey === 'zh' ? zh : en}`;

/** PluginHost 错误与诊断文本集中维护处，便于调用方和维护者查找。 */
const ERROR_TEXT = {
  get HOST_DISPOSED() {
    return localize('宿主已关闭', 'host is disposed');
  },
  get HOST_DISPOSING() {
    return localize('宿主正在关闭', 'host is disposing');
  },
  get INVALID_PIPELINE_MODE() {
    return localize('无效的 pipeline mode', 'invalid pipeline mode');
  },
  PIPELINE_MODE_MISMATCH: (hostMode: string, stageMode: string) =>
    localize(
      `host 处于 ${hostMode} 模式，不能注册 ${stageMode} stage`,
      `host is in ${hostMode} mode and cannot register a ${stageMode} stage`
    ),
  /** Pipeline stage 对同一次 step 重复调用了 next()。 */
  get PIPELINE_NEXT_ALREADY_CALLED() {
    return localize(
      'pipeline stage 对同一次调用重复触发了 next()',
      'pipeline stage called next() more than once for the same invocation'
    );
  },
  /** Stage 返回或调用完成后才调用 next()，该值已无法安全进入 pipeline。 */
  get PIPELINE_NEXT_CALLED_LATE() {
    return localize(
      'pipeline stage 在返回或调用完成后触发了 next()，该次调用已被忽略',
      'pipeline stage called next() after returning or completing; the call was ignored'
    );
  },
  get PIPELINE_EXECUTING() {
    return localize(
      'pipeline 执行期间不能注册 stage',
      'pipeline stages cannot be registered during pipeline execution'
    );
  },
  /** 插件不存在。 */
  get PLUGIN_NOT_INSTALLED() {
    return (name: string) => localize(`插件 "${name}" 未安装`, `plugin "${name}" is not installed`);
  },
  /** 插件卸载存在清理失败。 */
  get PLUGIN_DISPOSE_FAILED() {
    return (name: string) =>
      localize(`插件 "${name}" 卸载失败`, `plugin "${name}" failed to dispose`);
  },
  get HOST_DISPOSE_FAILED() {
    return localize('宿主卸载失败', 'host failed to dispose');
  },
  get PLUGIN_INSTALL_FAILED() {
    return (name: string) =>
      localize(`插件 "${name}" 安装失败`, `plugin "${name}" failed to install`);
  },
  get PLUGIN_ROLLBACK_FAILED() {
    return (name: string) =>
      localize(`插件 "${name}" 安装失败且回滚失败`, `plugin "${name}" install rollback failed`);
  },
  /** Shared key 重复。 */
  get SHARED_DUPLICATE() {
    return (key: PropertyKey) =>
      localize(
        `shared key "${String(key)}" 已经注册`,
        `shared key "${String(key)}" is already registered`
      );
  },
  /** 资源注册不在 install 生命周期内。 */
  get RESOURCE_OUTSIDE_INSTALL() {
    return localize(
      '资源只能在插件 install() 执行期间注册',
      'resources can only be registered during plugin install()'
    );
  },
  LIFECYCLE_MUTATION: localize(
    '插件生命周期内禁止调用 Host mutation',
    'Host mutations are forbidden during plugin lifecycle callbacks'
  ),
  /** 插件名称重复。 */
  get PLUGIN_DUPLICATE() {
    return (name: string) =>
      localize(`插件 "${name}" 已经安装`, `plugin "${name}" is already installed`);
  },
  /** 插件扩展属性冲突。 */
  get EXTENSION_DUPLICATE() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 扩展属性 "${String(key)}" 已被占用`,
        `plugin "${name}" extension "${String(key)}" is already occupied`
      );
  },
  get EXTENSION_OBJECT_PROTOTYPE() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 扩展属性 "${String(key)}" 与 Object 原型冲突`,
        `plugin "${name}" extension "${String(key)}" conflicts with the Object prototype`
      );
  },
  get EXTENSION_RESERVED() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 扩展属性 "${String(key)}" 是保留键`,
        `plugin "${name}" extension "${String(key)}" is reserved`
      );
  }
} as const;

export default ERROR_TEXT;
