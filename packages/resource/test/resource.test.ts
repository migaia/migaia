import { describe, expect, it } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { Resource } from '../src';

describe('resource foundation', () => {
  it('shares request state and settles successful fetches', async () => {
    const runtime = createRuntime();
    const resource = new Resource(async () => 42, runtime);

    expect(resource.state.status).toBe('pending');
    await expect(resource.promise).resolves.toBe(42);
    expect(resource.state).toEqual({ status: 'success', data: 42 });

    resource.dispose();
  });
});
