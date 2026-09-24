import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'

/** A3 creates the required two-level chain plus one optional direct consumer. */
const createFixture = async () => {
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const pValue = defineFeature(() => ({ value: 'p' }))
  const p = definePlugin({ name: 'p', features: { value: pValue }, install: () => ({ p: true }) })
  const aValue = defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
    p: p.getFeature('value')
  })
  const a = definePlugin({ name: 'a', features: { value: aValue }, install: () => ({ a: true }) })
  const bValue = defineFeature((_core, dependencies) => ({ value: dependencies.a.value }), {
    a: a.getFeature('value')
  })
  const b = definePlugin({ name: 'b', features: { value: bValue }, install: () => ({ b: true }) })
  const cValue = defineFeature(
    (_core, dependencies) => ({ present: dependencies.p !== undefined }),
    { p: p.getFeature('value', { optional: true }) }
  )
  const c = definePlugin({ name: 'c', features: { value: cValue }, install: () => ({ c: true }) })
  const handles = await host.use(p, a, b, c)
  return { host, handles }
}

/** Verifies reject, dry-run, retired option, and unknown-policy admission for one mutation. */
const verifyOptions = async (kind: 'remove' | 'disable'): Promise<void> => {
  const { host, handles } = await createFixture()
  const mutate = (options?: unknown) =>
    kind === 'remove'
      ? host.unUse('p', options as never)
      : host.plugin.disable('p', options as never)
  await expect(mutate()).rejects.toMatchObject({
    code: 'DEPENDENCY_BLOCKED',
    detail: { blockedBy: ['b', 'a'] }
  })
  expect(handles.map((handle) => handle.name)).toEqual(['p', 'a', 'b', 'c'])
  const action = kind === 'remove' ? 'release' : 'disable'
  await expect(mutate({ policy: 'cascade', dryRun: true })).resolves.toMatchObject({
    policy: 'cascade',
    order: ['b', 'a', 'p'],
    steps: [
      { name: 'b', action },
      { name: 'a', action },
      { name: 'p', action }
    ],
    edges: expect.arrayContaining([{ provider: 'p', consumer: 'c', optional: true }])
  })
  for (const invalid of [{ cascade: true }, { policy: 'x' }])
    await expect(mutate(invalid)).rejects.toMatchObject({
      name: 'TypeError',
      code: 'INVALID_OPTION'
    })
  expect(handles.map((handle) => handle.name)).toEqual(['p', 'a', 'b', 'c'])
  await host.dispose()
}

describe('dependency policy options', () => {
  it('validates removal policy before mutating the host', async () => verifyOptions('remove'))
  it('validates disable policy before mutating the host', async () => verifyOptions('disable'))
})
