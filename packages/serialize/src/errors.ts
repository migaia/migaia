import { SerializeErrorCode, type ISerializeErrorCode } from './error-code.js';

export { SerializeErrorCode, type ISerializeErrorCode };

/** 错误 `source` 的唯一字面量来源；禁止各处手写 `'@migaia/serialize'` 字符串。 */
export const SERIALIZE_SOURCE = '@migaia/serialize' as const;

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
  Object.defineProperty(error, 'source', { value: SERIALIZE_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
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
