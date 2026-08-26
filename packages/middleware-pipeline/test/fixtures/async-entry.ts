import { runAsyncMiddleware } from '@migaia/middleware-pipeline'

export const runAsyncOnly = (): Promise<void> =>
  runAsyncMiddleware([(value, next) => next(value + 1)], 1, () => undefined, {
    onViolation: () => undefined
  })
