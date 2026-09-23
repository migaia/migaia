/**
 * This file checks delivery-process artifacts, not product behavior. It needs workspace-local docs/
 * and is excluded from the package gate.
 */
import { readFile } from 'node:fs/promises'
import { it, expect } from 'vitest'

it('T295 final D95 mapping audit rejects stale bridge-injection claims', async () => {
  const document = await readFile(
    new URL(
      '../../../../docs/web-rpc/endpoint-feature-composition-continuation.sdd.md',
      import.meta.url
    ),
    'utf8'
  )
  for (const testId of [
    'T219',
    'T220',
    'T222',
    'T223',
    'T224',
    'T225',
    'T227',
    'T228',
    'T229',
    'T230'
  ]) {
    const row = document.split('\n').find((line) => line.includes(`WRC-C-${testId} |`))
    expect(row).toBeDefined()
    expect(row).toContain('superseded')
    expect(row).toContain('final deletion')
    expect(row).not.toContain('intentional RED')
  }
  const requirementRow = document.split('\n').find((line) => line.startsWith('| R73 |'))
  expect(requirementRow).toContain('T295')
  expect(requirementRow).toContain('historical')
  expect(requirementRow).toContain('superseded')
  for (const evidenceId of ['T220', 'T221', 'T267', 'T275'])
    expect(requirementRow).toContain(evidenceId)
})
