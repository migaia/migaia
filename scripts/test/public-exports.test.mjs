import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPublicExports } from '../public-exports.mjs'

/** Scoped child gates admit only the package names declared by the caller. */
const scope = process.env.PUBLIC_EXPORTS_SCOPE?.split(',').filter(Boolean) ?? []

test('tracked public export baseline covers every built package and exact concrete subpath', async (t) => {
  /** Strict mode rejects all drift; scoped mode returns only admitted symbol differences. */
  const differences = await checkPublicExports({ scope })
  for (const { sign, pkg, subpath, name } of differences)
    t.diagnostic(`${sign} ${pkg} ${subpath} ${name}`)
  if (scope.length === 0) assert.deepEqual(differences, [])
})
