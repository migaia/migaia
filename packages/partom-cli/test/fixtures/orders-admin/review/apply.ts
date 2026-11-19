// Simulated review, run with Bun in a copy of the fixture: applies `source.patch.json` to the
// generated blueprint with part-contract's JSON Patch implementation and puts the reviewed effects
// over the generated drafts.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { applyPatch } from '../../../../../part-contract/src/platform/patch.ts'

/** Generated blueprint of the orders page. */
const file = 'src/blueprints/orders-page.blueprint.json'
/** Patch operations of the review. */
const operations = JSON.parse(readFileSync('review/source.patch.json', 'utf8')) as Parameters<
  typeof applyPatch
>[1]
writeFileSync(
  file,
  JSON.stringify(applyPatch(JSON.parse(readFileSync(file, 'utf8')), operations), null, 2)
)
copyFileSync('review/effects/orders-page.ts', 'src/blueprints/effects/orders-page.ts')
