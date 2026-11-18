/** Built-in rule sets of the part contract; every entry of every host and tool uses this list. */
import type { IRuleDefinition } from '../rules.ts'
import { behaviorRules } from './behavior-rules.ts'
import { layoutRules } from './layout-rules.ts'
import { structureRules } from './structure-rules.ts'

/** All thirty-two built-in rules in a stable order. */
export const builtinRules: readonly IRuleDefinition<unknown>[] = [
  ...structureRules,
  ...behaviorRules,
  ...layoutRules
] as readonly IRuleDefinition<unknown>[]

export { behaviorRules, layoutRules, structureRules }
