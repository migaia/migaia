/**
 * Invokes an admitted callable with its captured receiver and arguments. This is the package-owned
 * boundary for preserving JavaScript receiver, argument, and thrown error identity while keeping
 * the exception to the repository context-rule explicit.
 */
export const invokeCaptured = <T>(
  callable: Function,
  receiver: unknown,
  args: readonly unknown[]
): T => Reflect.apply(callable, receiver, args) as T
