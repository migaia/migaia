/**
 * Rule ids of the issues the host itself reports while loading, outside the rule engine. They are
 * stable public strings: editors, `partom doctor` output and tests match on them.
 */
export const HostIssueRule = {
  /** A fragment usage's parameters fail the fragment's Standard Schema. */
  fragmentArgs: 'fragment.args',
  /** A modifier reference's arguments fail the modifier's Standard Schema. */
  modifierArgs: 'event.modifier-args'
} as const

/** One host issue rule id. */
export type HostIssueRule = (typeof HostIssueRule)[keyof typeof HostIssueRule]
