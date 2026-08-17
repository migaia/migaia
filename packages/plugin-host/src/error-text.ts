import type { IPluginHostErrorCode } from './typing.js';
import { PLUGIN_HOST_SOURCE, PluginHostErrorCode } from './error-code.js';

export type ILocaleKey = 'en' | 'zh';

export class PluginHostError extends Error {
  /** `(source, code)` 二元组的 source 部分，恒为 `'@migaia/plugin-host'`（`docs/contracts/error-codes.md` §2）。 */
  readonly source: string;
  readonly code: IPluginHostErrorCode;
  /** 结构化诊断（如 queue timeout 的 `owner`/`waitedMs`）；不与 `cause` 混用。 */
  readonly detail?: Readonly<Record<string, unknown>>;
  constructor(
    code: IPluginHostErrorCode,
    message: string,
    options?: ErrorOptions & { readonly detail?: Readonly<Record<string, unknown>> }
  ) {
    super(message, options);
    this.name = 'PluginHostError';
    this.source = PLUGIN_HOST_SOURCE;
    this.code = code;
    if (options?.detail !== undefined) this.detail = options.detail;
  }
}

/**
 * 给已经构造好的错误对象（`TypeError` 等）补上 `(source, code)`，不触碰 `message`/`name`/`stack`/构造函数带来的其它字段——
 * 用于入参校验这类必须保持原生类型（调用方按 `instanceof TypeError` 分支）的场景。返回类型把 `source`/`code` 交叉进原类型，
 * 使类型层面可访问（`docs/contracts/error-codes.md` §2）。
 */
export function tagPluginHostError<E extends Error>(
  error: E,
  code: IPluginHostErrorCode
): E & { readonly source: string; readonly code: IPluginHostErrorCode } {
  Object.defineProperty(error, 'source', { value: PLUGIN_HOST_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error as E & { readonly source: string; readonly code: IPluginHostErrorCode };
}

/** 入参校验错误：原生 `TypeError` + `INVALID_OPTION`（`docs/contracts/error-codes.md` §7 裸抛扫描门禁）。 */
export function createPluginHostTypeError(
  message: string
): TypeError & { readonly source: string; readonly code: IPluginHostErrorCode } {
  return tagPluginHostError(new TypeError(message), PluginHostErrorCode.invalidOption);
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
  },
  /** 正式 SLA：mutation 在 FIFO 队列中等待超过阈值。 */
  get MUTATION_QUEUE_TIMEOUT() {
    return (waitedMs: number) =>
      localize(
        `mutation 在队列中等待超过 ${waitedMs}ms，已拒绝执行`,
        `mutation waited in the queue for more than ${waitedMs}ms and was rejected`
      );
  },
  /** 诊断：install() 返回值上一个非枚举键被跳过挂载（不是错误，是有意的行为，但必须可观测）。 */
  get EXTENSION_NON_ENUMERABLE_IGNORED() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 的非枚举扩展属性 "${String(key)}" 未挂载到 host——` +
          `非枚举键被有意忽略，如需暴露请改成枚举属性`,
        `plugin "${name}"'s non-enumerable extension property "${String(key)}" was not mounted ` +
          `on the host — non-enumerable keys are intentionally ignored; make it enumerable to ` +
          `expose it`
      );
  },
  /**
   * 正式 SLA：单个 disposer（pipeline disposer / 插件 dispose 钩子 / resource disposer） 等待超过阈值仍未 settle，包括该
   * disposer 反过来 await 了同一次 dispose() 调用自身这种 循环等待。不会中断 disposer 的执行（JS 无法安全撤销已经在跑的 Promise 链），只是停止
   * 等待并把这一步计为失败，让整个 dispose 事务仍能收敛到 disposed。
   */
  get DISPOSE_STEP_TIMEOUT() {
    return (phase: string, waitedMs: number) =>
      localize(
        `${phase} 等待超过 ${waitedMs}ms 仍未完成，已放弃等待并计为失败——如果该 disposer ` +
          `反过来 await 了触发它的这次 host.dispose() 调用，这个等待永远无法完成`,
        `${phase} did not settle within ${waitedMs}ms and was abandoned as a failure — if that ` +
          `disposer awaits the very host.dispose() call that triggered it, this wait can never ` +
          `complete on its own`
      );
  }
} as const;

export default ERROR_TEXT;
