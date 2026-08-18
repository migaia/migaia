/** `source` value stamped onto every error this package throws. */
export const RESOURCE_SOURCE = '@migaia/resource';

/**
 * 全仓统一的结构契约（`docs/contracts/error-codes.md` §2）：错误以属性形式携带 `source`/`code`， 从不替换错误本身——依赖 `instanceof
 * DOMException`/`RangeError` 等类型判断的调用方不受影响。
 */
export type IResourceError = Error & {
  readonly source: string;
  readonly code: string;
};

/** 构造一个携带 `(source, code)` 的普通 `Error`，从不改写 `stack`——引擎在构造时就已经填好， 本函数不会重新赋值，原始抛出点始终可见。 */
export function createResourceError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown }
): IResourceError {
  const error = new Error(message, options);
  Object.defineProperty(error, 'source', {
    value: RESOURCE_SOURCE,
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(error, 'code', { value: code, enumerable: true, configurable: true });
  return error as IResourceError;
}

/**
 * 给已经构造好的错误对象（`DOMException`/`RangeError` 等）补上 `(source, code)`， 不触碰
 * `message`/`name`/构造函数带来的其它字段——用于类型本身对调用方有意义、不能被 `createResourceError` 的纯 `Error`
 * 替代的场景（`REQUEST_ABORTED`/`REQUEST_CANCELLED` 必须保持 `DOMException` 且 `name === 'AbortError'`）。泛型不约束到
 * `Error`：TypeScript 的 `DOMException` 类型不是 `Error` 的子类型，但两者在运行时都是可挂只读属性的普通对象。
 */
export function tagResourceError<E extends object>(error: E, code: string): E {
  Object.defineProperty(error, 'source', {
    value: RESOURCE_SOURCE,
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(error, 'code', { value: code, enumerable: true, configurable: true });
  return error;
}
