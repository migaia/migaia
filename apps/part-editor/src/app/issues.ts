import {
  createRuleEngine,
  descriptorView,
  parseBlueprint,
  type IDescriptor,
  type IIssue
} from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'

/** Rule id of a document that does not parse. */
export const PARSE_RULE = 'editor.parse'

/**
 * Built-in authored issues of a document, checked against the loaded descriptors. A document that
 * does not parse yields one `editor.parse` error carrying the parse error on `cause`.
 */
export function authoredIssues(
  document: unknown,
  descriptors: readonly IDescriptor[]
): readonly IIssue[] {
  try {
    return createRuleEngine({ rules: builtinRules, catalog: descriptorView(descriptors) }).run(
      'authored',
      parseBlueprint(document)
    )
  } catch (cause) {
    return [
      {
        address: '',
        facet: '',
        path: '',
        code: PARSE_RULE,
        rule: PARSE_RULE,
        messageKey: String((cause as { message?: unknown }).message ?? cause),
        severity: 'error',
        cause
      }
    ]
  }
}

/** Identity of an issue for de-duplication across the local run and the preview. */
function issueKey(issue: IIssue): string {
  return `${issue.rule}|${issue.address}|${issue.facet}|${issue.path}`
}

/**
 * Issues of one blueprint: the local authored run plus the issues the preview sent back (project
 * rules and resolved issues, with their `fix`). A preview issue wins over a local one of the same
 * rule and place because it carries the project's view.
 */
export function mergedIssues(local: readonly IIssue[], preview: readonly IIssue[]): IIssue[] {
  /** Issues by key. */
  const byKey = new Map<string, IIssue>()
  for (const issue of local) byKey.set(issueKey(issue), issue)
  for (const issue of preview) byKey.set(issueKey(issue), issue)
  return [...byKey.values()]
}

/** Issues grouped by address. */
export function issuesByAddress(issues: readonly IIssue[]): Map<string, IIssue[]> {
  /** Groups. */
  const groups = new Map<string, IIssue[]>()
  for (const issue of issues) {
    /** Group of the address. */
    const group = groups.get(issue.address) ?? []
    group.push(issue)
    groups.set(issue.address, group)
  }
  return groups
}
