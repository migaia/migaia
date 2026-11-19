import {
  createRuleEngine,
  descriptorView,
  parseBlueprint,
  type IBlueprint,
  type ICatalogView,
  type IIssue,
  type IPartSnapshot
} from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'

/** Rule id of a lock definition that no descriptor or module provides. */
export const MISSING_DEFINITION_RULE = 'catalog.definition-missing'

/** Authored-phase built-in issues of one blueprint against a view. */
export function blueprintIssues(document: unknown, view: ICatalogView): readonly IIssue[] {
  return createRuleEngine({ rules: builtinRules, catalog: view }).run(
    'authored',
    parseBlueprint(document)
  )
}

/**
 * Upload validation of a snapshot: built-in authored rules (including `security.secret`) on every
 * blueprint against the snapshot's descriptors, and every lock definition provided by a descriptor
 * or a module export. Only errors are returned.
 */
export function uploadIssues(snapshot: IPartSnapshot): IIssue[] {
  /** View over the snapshot's descriptors. */
  const view = descriptorView(snapshot.descriptors)
  /** Ids exported by the snapshot's modules. */
  const exported = new Set(
    snapshot.lock.modules.flatMap((module) => module.exports.map((entry) => entry.id))
  )
  /** Collected errors. */
  const issues: IIssue[] = []
  for (const blueprint of snapshot.blueprints)
    issues.push(
      ...blueprintIssues(blueprint as IBlueprint, view).filter(
        (issue) => issue.severity === 'error'
      )
    )
  for (const id of snapshot.lock.definitions)
    if (view.get(id) === undefined && !exported.has(id))
      issues.push({
        address: '',
        facet: 'lock',
        path: id,
        code: MISSING_DEFINITION_RULE,
        rule: MISSING_DEFINITION_RULE,
        messageKey: MISSING_DEFINITION_RULE,
        severity: 'error'
      })
  return issues
}
