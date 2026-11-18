import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Trigger } from '../shared/parts.tsx'

/**
 * Test hook of this fixture only: with `PARTOM_FIXTURE_SLOW_MS` set, loading the config in a doctor
 * child blocks for that long, so a test can change files while a rebuild is running. The browser
 * bundle has no `Bun` global and skips it.
 */
const slowMs = Number(globalThis.process?.env?.PARTOM_FIXTURE_SLOW_MS ?? 0)
if (slowMs > 0 && typeof globalThis.Bun !== 'undefined') Bun.sleepSync(slowMs)

/** Panel part emitting a non-cancelable custom event, used for a warning-only blueprint. */
const panelPart = definePart({
  id: 'panel@1',
  behavior: { semantics: { element: 'button' } },
  events: { 'app:expand': { kind: 'custom' } }
})

/** Fixture-local plugin; tests break and restore this file to provoke a failed rebuild. */
export const appPlugin = definePartPlugin({
  name: 'app',
  parts: [panelPart],
  implementations: [bindReactComponent(panelPart, Trigger)]
})
