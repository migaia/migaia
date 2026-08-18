import { describe, expect, it } from 'vitest';
import { Logger } from '../src/log.js';
import type { ILogFailure, ILoggerCore } from '../src/typing.js';

type IPhaseCase = {
  readonly hookName: string;
  readonly label: string;
};

type IExtendTarget = Parameters<ILoggerCore['extends']>[0];
type IPhaseLogger = Pick<ILoggerCore, 'log' | 'useSink'>;

const phaseCases: readonly IPhaseCase[] = [
  { hookName: 'before', label: 'before' },
  { hookName: 'before:info', label: 'before:tag' },
  { hookName: 'after', label: 'after' },
  { hookName: 'after:info', label: 'after:tag' }
];

/** Dispatches one entry through every built-in phase so the case reaches its registered hook. */
function dispatchPhaseEntry(logger: IPhaseLogger): void {
  logger.useSink(() => undefined);
  logger.log('info', 'phase-hook-tracking');
}

describe('phase hook tracking', () => {
  it.each(phaseCases)(
    'reports one upstream $label rejection and drains it',
    async ({ hookName, label }) => {
      const logger = new Logger();
      const rejection = new Error(`${label}-upstream`);
      const failures: ILogFailure[] = [];
      logger.onFailure((failure) => failures.push(failure));
      logger.hook(hookName, () => Promise.reject(rejection));

      dispatchPhaseEntry(logger);

      await expect(logger.flush()).resolves.toBeUndefined();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ source: 'hook', error: rejection });
    }
  );

  it('reports one synchronous before continuation failure and drains it', async () => {
    const logger = new Logger();
    const continuationError = new Error('before-continuation');
    const failures: ILogFailure[] = [];
    const tag = {
      [Symbol.toPrimitive]: () => {
        throw continuationError;
      }
    } as unknown as string;
    logger.onFailure((failure) => failures.push(failure));
    logger.hook('before', async () => undefined);
    logger.dispatchRaw({ tag, message: 'before-continuation' });

    await expect(logger.flush()).resolves.toBeUndefined();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ source: 'hook', error: continuationError });
  });

  it.each([
    { hookName: 'after', label: 'after' },
    { hookName: 'after:info', label: 'after:tag' }
  ])(
    'reports one synchronous $label continuation failure and drains it',
    async ({ hookName, label }) => {
      const logger = new Logger();
      const continuationError = new Error(`${label}-continuation`);
      const failures: ILogFailure[] = [];
      let contextReads = 0;
      const target = {
        get ctx() {
          contextReads += 1;
          if (contextReads > 1) throw continuationError;
          return { id: `${label}-target`, topic: label };
        },
        dispatchRaw: () => undefined,
        flush: () => Promise.resolve()
      } as unknown as ILoggerCore;
      logger.onFailure((failure) => failures.push(failure));
      logger.extends(target as IExtendTarget);
      logger.hook(hookName, async () => undefined);
      logger.log('info', `${label}-continuation`);

      await expect(logger.flush()).resolves.toBeUndefined();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ source: 'hook', error: continuationError });
    }
  );
});
