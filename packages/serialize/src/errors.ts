import { SerializeErrorCode, type ISerializeErrorCode } from './error-code.js';
import { attachErrorIdentity } from '@migaia/utils/error';

export { SerializeErrorCode, type ISerializeErrorCode };

/** 错误 `source` 的唯一字面量来源；禁止各处手写 `'@migaia/serialize'` 字符串。 */
export const SERIALIZE_SOURCE = '@migaia/serialize' as const;

/** Stable registry-option diagnostics used by construction-time validation. */
export const SerializeErrorText = {
  /** Generic boundary text for an option accessor that threw during admission. */
  registryOptionReadFailed: 'serialize registry option could not be read',
  /** Stable boundary text for a plugin-list container or iterator that fails during admission. */
  pluginListInvalid: 'serialize plugin list is invalid',
  /** Scheduler capability shape required by registry deadline handling. */
  schedulerInvalid: 'serialize scheduler must be { now, schedule }',
  /** Boundary text for a scheduler accessor failure during core admission. */
  schedulerAccessorFailed: 'serialize scheduler accessor could not be read',
  /** Boundary text for a scheduler clock value with the wrong runtime type. */
  schedulerNowType: 'serialize scheduler now() must return a number',
  /** Boundary text for a scheduler clock value outside the finite numeric domain. */
  schedulerNowRange: 'serialize scheduler now() must return a finite number',
  /** Boundary text for a scheduler task with no callable cancel capability. */
  schedulerTaskInvalid: 'serialize scheduler task must provide cancel()',
  /** Boundary text for a task cancel accessor failure during core admission. */
  schedulerTaskCancelGetterFailed: 'serialize scheduler task cancel accessor could not be read',
  /** Boundary text for a failure while releasing an admitted scheduler task. */
  schedulerTaskCancelFailed: 'serialize scheduler task cancel() failed',
  /** Encoder capability shape required when a registry is constructed. */
  encoderInvalid: 'serialize encoder must provide encode() as a function',
  /** Decoder capability shape required when a registry is constructed. */
  decoderInvalid: 'serialize decoder must provide decode() as a function',
  /** Reporter callback shape required for secondary error observation. */
  reportInvalid: 'serialize report must be a function',
  /** Drain-timeout observer shape required for deadline diagnostics. */
  onDrainTimeoutInvalid: 'serialize onDrainTimeout must be a function',
  /** Cleanup policy shape required before a registry can publish disposal state. */
  cleanupInvalid: 'serialize cleanup policy must be throw or report',
  /** Cleanup reporter shape required by the report policy. */
  cleanupReportInvalid: 'serialize cleanup.report must be a function',
  /** Boundary text for a failure while installing a structural abort-signal listener. */
  signalRegistrationFailed: 'serialize abort signal listener registration failed',
  /** Boundary text for a failure while notifying an internal composed-signal listener. */
  signalDispatchFailed: 'serialize abort signal listener dispatch failed',
  /** Boundary text for an operation option accessor or shape that cannot be admitted. */
  operationOptionInvalid: 'serialize operation option is invalid',
  /** Boundary text for a structural abort-signal accessor failure. */
  signalAccessorFailed: 'serialize abort signal accessor could not be read',
  /** Boundary text for a reason accessor failure after an abort is observed. */
  signalReasonReadFailed: 'serialize abort signal reason could not be read',
  /** Structural abort-signal shape required before parser admission. */
  signalInvalid:
    'serialize abort signal must provide aborted, addEventListener(), and removeEventListener()',
  /** Deterministic fallback when a hostile failure cannot expose a safe textual reason. */
  reasonUnavailable: 'serialize failure reason unavailable',
  /** Stable prefix for a text encoder call failure during chunk collection. */
  textEncodeFailed: 'serialize text encoding failed',
  /** Stable diagnostic for an encoder result that cannot be merged as bytes. */
  textEncoderOutputInvalid: 'serialize text encoder must return a Uint8Array'
} as const;

/** 结构化 tagged 错误：原生错误类型 `TError` 交叉附加 `source`/`code`/`context?`。运行时仍为 `TError`（`instanceof` 保持真）。 */
export type ISerializeTaggedError<TError extends Error> = TError & {
  readonly source: string;
  readonly code: ISerializeErrorCode;
  readonly context?: string;
};
export type ISerializeTypeError = ISerializeTaggedError<TypeError>;
export type ISerializeRangeError = ISerializeTaggedError<RangeError>;
/** 构造/生命周期错误的 tagged 原生 Error（`cause` 继承自 `Error`，另含 `errors`）。 */
export type ISerializeLifecycleError = ISerializeTaggedError<Error> & {
  readonly errors?: readonly unknown[];
};

/**
 * 只读附加 `source`/`code`（及可选 `context`），返回带字段的原对象：不重建、不替换、不覆盖 stack。
 *
 * **幂等（方案 A）**：已标记且 `(source, code)` 一致 → 直接返回（`context` 仅在未定义时写入一次）；已标记但 `(source, code)` 不一致 → 抛
 * TypeError（不得静默改写，避免二次 `defineProperty` 触发 `configurable: false` 抛错）。
 */
export function tagSerializeError<E extends Error>(
  error: E,
  code: ISerializeErrorCode,
  context?: string
): ISerializeTaggedError<E> {
  const tagged = error as ISerializeTaggedError<E>;
  const already = (error as { readonly source?: string }).source !== undefined;
  if (already) {
    if (tagged.source === SERIALIZE_SOURCE && tagged.code === code) {
      if (context !== undefined && tagged.context === undefined) {
        Object.defineProperty(error, 'context', { value: context, enumerable: true });
      }
      return tagged;
    }
    throw new TypeError(
      `serialize error already tagged with a different (source, code): ${tagged.source}, ${tagged.code}`
    );
  }
  attachErrorIdentity(error, { source: SERIALIZE_SOURCE, code });
  if (context !== undefined) {
    Object.defineProperty(error, 'context', { value: context, enumerable: true });
  }
  return tagged;
}

/**
 * 构造/生命周期错误（`REGISTRY_DISPOSED`/`ENV_UNSUPPORTED`/rollback）：原生 Error +
 * source/code/context/cause/errors。
 *
 * `errors` 是 rollback 完成后一次性创建的不可变快照（`Object.freeze`），空则省略字段、不替换 `cause`。
 */
export function createSerializeError(
  code: ISerializeErrorCode,
  message: string,
  options?: {
    readonly cause?: unknown;
    readonly context?: string;
    readonly errors?: readonly unknown[];
  }
): ISerializeLifecycleError {
  const error = tagSerializeError(
    new Error(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code,
    options?.context
  );
  if (options?.errors !== undefined && options.errors.length > 0) {
    Object.defineProperty(error, 'errors', {
      value: Object.freeze([...options.errors]),
      enumerable: true
    });
  }
  return error;
}

/** 参数错误（scheduler 结构非法）：原生 TypeError + `INVALID_OPTION`。 */
export function createSerializeTypeError(
  code: ISerializeErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly context?: string }
): ISerializeTypeError {
  return tagSerializeError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code,
    options?.context
  );
}

/** 插件校验失败（空表 / 重复 / 非法 type）：原生 RangeError + `INVALID_OPTION`。 */
export function createSerializeRangeError(
  code: ISerializeErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly context?: string }
): ISerializeRangeError {
  return tagSerializeError(
    new RangeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code,
    options?.context
  );
}
