import { describe, expect, it } from 'vitest';
import { HookRegistry } from '../../src/internal/hooks';

describe('HookRegistry', () => {
  it('isolates thenable and diagnostic failures', async () => {
    const diagnostics: unknown[] = [];
    const registry = new HookRegistry();
    registry.add(
      () =>
        ({
          // oxlint-disable-next-line unicorn/no-thenable
          then: (_resolve: () => void, reject: (error: unknown) => void) => reject('bad')
        }) as never
    );
    registry.emit({ name: 'test', at: 0, localId: 'a' }, (error) => {
      diagnostics.push(error);
      throw new Error('diagnostic failed');
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(diagnostics).toEqual(['bad']);
  });
});
