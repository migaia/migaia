import { runSyncMiddleware } from '../../src/index.js';

/** Minimal consumer entry used to prove unused async/generator modes leave the bundle. */
export const runSyncOnly = (value: number): number => {
  let result = value;
  runSyncMiddleware(
    [(current, next) => next(current + 1)],
    value,
    (current) => {
      result = current;
    },
    () => undefined
  );
  return result;
};
