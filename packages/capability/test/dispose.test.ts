import type {
  IGenerationController,
  IGenerationRequest,
  IGenerationToken
} from '@migaia/lifecycle';
import { describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  throwOnController: -1,
  cleanupError: undefined as unknown
}));

vi.mock('@migaia/lifecycle', async () => {
  const actual = await vi.importActual<typeof import('@migaia/lifecycle')>('@migaia/lifecycle');
  let controllerCount = 0;

  return {
    ...actual,
    createGenerationController: (): IGenerationController => {
      const controller = actual.createGenerationController();
      const ordinal = controllerCount++;
      return {
        get generation() {
          return controller.generation;
        },
        get disposed() {
          return controller.disposed;
        },
        begin(options?: { readonly timeoutMs?: number }): IGenerationRequest {
          return controller.begin(options);
        },
        isCurrent(token: IGenerationToken): boolean {
          return controller.isCurrent(token);
        },
        supersede(reason?: unknown): void {
          controller.supersede(reason);
        },
        adopt<T>(
          token: IGenerationToken,
          value: T,
          release: (released: T) => void | PromiseLike<void>,
          onReleaseError?: (error: unknown) => void
        ): boolean {
          return controller.adopt(token, value, release, onReleaseError);
        },
        dispose(reason?: unknown): void {
          controller.dispose(reason);
          if (ordinal === mockState.throwOnController) throw mockState.cleanupError;
        }
      };
    }
  };
});

import { CapabilityErrorCode, createCapabilityHost } from '../src/index.js';

describe('dispose generation cleanup isolation', () => {
  it('reports a generation cleanup failure and still releases every active handle', async () => {
    const generationError = new Error('generation cleanup failed');
    const handleError = new Error('second handle cleanup failed');
    const releaseOrder: string[] = [];
    const onError = vi.fn();
    mockState.throwOnController = 0;
    mockState.cleanupError = generationError;
    const host = createCapabilityHost(undefined, {
      flags: { first: true, second: true },
      onError
    });
    host.register({
      name: 'first',
      activate: () => ({
        dispose: () => {
          releaseOrder.push('first');
        }
      })
    });
    host.register({
      name: 'second',
      activate: () => ({
        dispose: () => {
          releaseOrder.push('second');
          throw handleError;
        }
      })
    });

    await host.enable('first');
    await host.enable('second');
    const firstDispose = host.dispose();

    expect(host.disposed).toBe(true);
    await expect(host.dispose()).rejects.toEqual(
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning
      })
    );
    await expect(firstDispose).resolves.toBeUndefined();
    expect(releaseOrder).toEqual(['second', 'first']);
    expect(onError.mock.calls).toEqual([
      ['first', generationError],
      ['second', handleError]
    ]);
    expect(host.error('first')).toBe(generationError);
    expect(host.error('second')).toBe(handleError);
    expect(host.state('first')).toBe('off');
    expect(host.state('second')).toBe('off');
    expect(host.handle('first')).toBeUndefined();
    expect(host.handle('second')).toBeUndefined();
    expect(host.dispose()).toBe(firstDispose);
  });
});
