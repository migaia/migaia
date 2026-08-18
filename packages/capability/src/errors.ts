/** `source` value stamped onto every error this package throws. */
export const CAPABILITY_SOURCE = '@migaia/capability';

import { attachErrorIdentity } from '@migaia/utils/error';

/**
 * 全仓统一的结构契约（`docs/contracts/error-codes.md` §2）：错误以属性形式携带 `source`/`code`， 从不替换错误本身——依赖 `instanceof
 * TypeError`/`RangeError` 等类型判断的调用方不受影响。
 */
export type ICapabilityError = Error & {
  readonly source: string;
  readonly code: string;
};

/** 构造一个携带 `(source, code)` 的普通 `Error`，从不改写 `stack`——引擎在构造时就已经填好， 本函数不会重新赋值，原始抛出点始终可见。 */
export function createCapabilityError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown }
): ICapabilityError {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return attachErrorIdentity(error, { source: CAPABILITY_SOURCE, code }) as ICapabilityError;
}

/**
 * 给已经构造好的错误对象（`TypeError` 等）补上 `(source, code)`，不触碰 `message`/`name`/构造函数带来的其它字段
 * ——用于类型本身对调用方有意义、不能被 `createCapabilityError` 的纯 `Error` 替代的场景（`INVALID_NAME`/`INVALID_ACTIVATE`/
 * `INVALID_HANDLE` 必须保持 `TypeError` 类型不变）。
 */
export function tagCapabilityError<E extends Error>(error: E, code: string): E {
  return attachErrorIdentity(error, { source: CAPABILITY_SOURCE, code });
}
