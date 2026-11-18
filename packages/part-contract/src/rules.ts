import {
  createAddressIndex,
  tagSegmentName,
  type IAddressIndex,
  type IIndexedNode
} from './address.ts'
import { PartContractErrorCode } from './error-code.ts'
import type {
  IBlueprint,
  ICatalogView,
  IIssue,
  IJsonPatchOperation,
  IJsonSchema,
  IKindSchema,
  IPartAddress,
  IPartNode
} from './types.ts'

/** Phases a rule can run in. Rendered checks are not rules; the CLI runs them itself. */
export type IRulePhase = 'authored' | 'resolved'

/** Issue fields a rule supplies; the engine adds the rule id and defaults. */
export type IIssueInput = {
  readonly address: IPartAddress
  readonly facet: string
  readonly path: string
  readonly messageKey: string
  readonly code?: string
  readonly severity?: 'error' | 'warning'
  readonly basis?: string
  readonly fix?: readonly IJsonPatchOperation[]
}

/** What a rule's `check` receives. `node` and `address` are absent for blueprint-scope rules. */
export type IRuleContext<TArgs> = {
  readonly phase: IRulePhase
  readonly node?: IPartNode
  readonly address?: IPartAddress
  readonly index: IAddressIndex
  readonly catalog: ICatalogView
  readonly args: TArgs
  report(issue: IIssueInput): void
  provided(node: IPartNode, path: string): boolean
}

/** Rule definition input. `targets` lists part names (without major), or `*` for every node. */
export type IRuleSpec<TArgs> = {
  readonly id: string
  readonly targets?: readonly string[]
  readonly scope: 'part' | 'blueprint'
  readonly phase: IRulePhase | readonly IRulePhase[]
  readonly severity: 'error' | 'warning'
  readonly args?: IJsonSchema
  readonly defaultArgs?: TArgs
  readonly reads?: readonly string[]
  check(context: IRuleContext<TArgs>): void
}

/** Frozen rule definition produced by `defineRule`. */
export type IRuleDefinition<TArgs> = Readonly<IRuleSpec<TArgs>> & {
  readonly phases: ReadonlySet<IRulePhase>
}

/** Rule engine bound to a rule set, a catalog view and an extension kind table. */
export type IRuleEngine = {
  run(
    phase: IRulePhase,
    blueprint: IBlueprint,
    options?: { readonly changed?: readonly IPartAddress[] }
  ): readonly IIssue[]
}

/** Freezes a rule specification and precomputes its phase set. */
export function defineRule<TArgs>(spec: IRuleSpec<TArgs>): IRuleDefinition<TArgs> {
  /** Phases normalized to a set for constant-time admission. */
  const phases = new Set<IRulePhase>(typeof spec.phase === 'string' ? [spec.phase] : spec.phase)
  return Object.freeze({ ...spec, phases })
}

/** Engine options. `kinds` is the caller-owned extension kind table. */
export type IRuleEngineOptions = {
  readonly rules: readonly IRuleDefinition<unknown>[]
  readonly catalog: ICatalogView
  readonly kinds?: ReadonlyMap<string, IKindSchema>
}

/** Collects issues of one run and builds rule contexts for it. */
class RuleRun {
  /** Issues in report order. */
  readonly issues: IIssue[] = []
  /** Phase of this run. */
  readonly #phase: IRulePhase
  /** Index of the blueprint under check. */
  readonly #index: IAddressIndex
  /** Catalog view rules consult. */
  readonly #catalog: ICatalogView

  /** Captures the run's fixed inputs. */
  constructor(phase: IRulePhase, index: IAddressIndex, catalog: ICatalogView) {
    this.#phase = phase
    this.#index = index
    this.#catalog = catalog
  }

  /** Runs one rule against one node, or against the whole blueprint when `entry` is absent. */
  apply(rule: IRuleDefinition<unknown>, entry: IIndexedNode | undefined): void {
    /** Address used for a RULE_FAILED issue. */
    const fallback = entry?.address ?? (this.#index.entries().next().value?.address as string)
    try {
      rule.check({
        phase: this.#phase,
        node: entry?.node,
        address: entry?.address,
        index: this.#index,
        catalog: this.#catalog,
        args: rule.defaultArgs,
        report: (issue) => this.report(rule, issue),
        provided: (node, path) => this.provided(node, path)
      })
    } catch (cause) {
      this.issues.push({
        address: fallback,
        facet: '',
        path: '',
        code: PartContractErrorCode.ruleFailed,
        rule: rule.id,
        messageKey: 'rule.failed',
        severity: 'error',
        cause
      })
    }
  }

  /** Converts a rule's issue input into a full issue. */
  report(rule: IRuleDefinition<unknown>, issue: IIssueInput): void {
    this.issues.push({
      ...issue,
      rule: rule.id,
      code: issue.code ?? rule.id,
      severity: issue.severity ?? rule.severity
    })
  }

  /** In the authored phase, a field an enhancer declares in `writes` counts as provided. */
  provided(node: IPartNode, path: string): boolean {
    return this.#phase === 'authored' && this.#catalog.writesFor(node.tag).includes(path)
  }
}

/** True when a rule targets the node's part name. */
function targets(rule: IRuleDefinition<unknown>, node: IPartNode): boolean {
  return (
    rule.targets === undefined ||
    rule.targets.includes('*') ||
    rule.targets.includes(tagSegmentName(node.tag))
  )
}

/**
 * Creates a rule engine. A run walks the index once per part rule (only `changed` addresses when
 * given) and calls each blueprint rule once; output keeps report order and is never sorted.
 */
export function createRuleEngine(options: IRuleEngineOptions): IRuleEngine {
  return {
    run: (phase, blueprint, runOptions) => runRules(options, phase, blueprint, runOptions?.changed)
  }
}

/** Executes one engine run. */
function runRules(
  options: IRuleEngineOptions,
  phase: IRulePhase,
  blueprint: IBlueprint,
  changed: readonly IPartAddress[] | undefined
): readonly IIssue[] {
  /** Address index shared by every rule of this run. */
  const index = createAddressIndex(blueprint)
  /** Issue collector and context factory. */
  const run = new RuleRun(phase, index, options.catalog)
  /** Changed addresses as a set, when the run is incremental. */
  const changedSet = changed === undefined ? undefined : new Set(changed)
  for (const rule of options.rules) {
    if (!rule.phases.has(phase)) continue
    if (rule.scope === 'blueprint') {
      run.apply(rule, undefined)
      continue
    }
    for (const entry of index.entries())
      if ((changedSet === undefined || changedSet.has(entry.address)) && targets(rule, entry.node))
        run.apply(rule, entry)
  }
  return run.issues
}
