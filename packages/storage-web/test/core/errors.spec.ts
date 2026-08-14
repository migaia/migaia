import { describe, expect, it } from 'vitest';
import { invokeExtension } from '../../src/core/errors';

describe('invokeExtension abort lifecycle', () => {
  it('关闭 check-subscribe race 并阻止扩展结果胜出', async () => {
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason: 'extension race',
      addEventListener: () => {
        aborted = true;
      },
      removeEventListener: () => {}
    } as never;
    await expect(
      invokeExtension(async () => 'late result', 'memory', 'entity.validate', 'schema', signal)
    ).rejects.toMatchObject({
      code: 'ABORTED',
      backend: 'memory',
      operation: 'entity.validate',
      extensionStage: 'schema',
      cause: 'extension race'
    });
  });

  it('listener setup 错误归一化且 cleanup 错误不覆盖扩展结果', async () => {
    const setupCause = new Error('hostile extension listener setup');
    await expect(
      invokeExtension(async () => 'value', 'memory', 'entity.validate', 'schema', {
        aborted: false,
        addEventListener: () => {
          throw setupCause;
        },
        removeEventListener: () => {}
      } as never)
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      backend: 'memory',
      operation: 'entity.validate',
      extensionStage: 'schema',
      cause: setupCause
    });
    await expect(
      invokeExtension(async () => 'value', 'memory', 'entity.validate', 'schema', {
        aborted: false,
        addEventListener: () => {},
        removeEventListener: () => {
          throw new Error('hostile extension listener cleanup');
        }
      } as never)
    ).resolves.toBe('value');
  });
});
