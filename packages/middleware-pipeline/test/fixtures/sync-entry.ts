import { runSyncMiddleware } from '@migaia/middleware-pipeline';
import type { ISyncMiddlewareStage } from '@migaia/middleware-pipeline';

/** Public-package stage type consumed by an isolated package-export fixture. */
const increment: ISyncMiddlewareStage<number> = (current, next) => next(current + 1);

/** Minimal package consumer entry used to prove unused modes leave the bundle. */
export const runSyncOnly = (value: number): number => {
  let result = value;
  runSyncMiddleware(
    [increment],
    value,
    (current) => {
      result = current;
    },
    () => undefined
  );
  return result;
};
