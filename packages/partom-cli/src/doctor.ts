import { readFileSync } from 'node:fs'
import type { IIssue } from '@migaia/part-contract'
import type { IPartHost, IPartHostOptions, IResolvedNode } from '@migaia/part-host'
import { serializeCause } from './errors.ts'
import { Harness } from './harness.ts'
import type { Project } from './project.ts'

/** Rule id of the issue recorded when loading one blueprint throws (parse or expansion error). */
const LOAD_RULE = 'doctor.load'
/** Code used when a load error carries no code of its own. */
const LOAD_FALLBACK_CODE = 'LOAD_FAILED'
/** Skip reason of a blueprint with static errors. */
const STATIC_ERRORS = 'static errors'
/** Skip reason of a blueprint whose load threw. */
const LOAD_ERROR = 'load error'

/** Options of one doctor run. */
export type IDoctorOptions = {
  readonly config: string | undefined
  readonly rendered: boolean
  readonly only: string | undefined
  readonly browser: string | undefined
}

/** Rendered-check status of one blueprint. */
export type IRenderedStatus = {
  readonly blueprintId: string
  readonly status: 'checked' | 'skipped'
  readonly reason?: string
}

/** Result of a doctor run. */
export type IDoctorResult = {
  readonly issues: readonly IIssue[]
  readonly rendered: readonly IRenderedStatus[]
}

/** Targets of the rendered check found in one mounted blueprint. */
type ITargets = {
  readonly patterns: readonly { readonly address: string; readonly pattern: string }[]
  readonly layers: readonly { readonly address: string; readonly path: string }[]
}

/** Collects pattern and layer targets of a resolved tree in one walk. */
function collectTargets(
  node: IResolvedNode,
  into: { patterns: ITargets['patterns'][number][]; layers: ITargets['layers'][number][] }
): void {
  /** Claimed pattern. */
  const pattern = node.behavior.semantics?.pattern
  if (pattern !== undefined) into.patterns.push({ address: node.address, pattern })
  if (node.behavior.layer !== undefined && node.openStatePath !== undefined)
    into.layers.push({ address: node.address, path: node.openStatePath })
  for (const child of node.children) collectTargets(child, into)
  for (const members of Object.values(node.slots))
    for (const member of members) collectTargets(member, into)
}

/** Issue reported by a rendered check. */
function renderedIssue(address: string, rule: string, message: string, basis: string): IIssue {
  return {
    address,
    facet: 'rendered',
    path: '',
    code: 'RENDERED_CHECK',
    rule,
    messageKey: message,
    severity: 'error',
    basis
  }
}

/**
 * Runs authored and resolved checks on every blueprint of the config, then rendered checks when
 * asked.
 */
export async function runDoctor(project: Project, options: IDoctorOptions): Promise<IDoctorResult> {
  /** Validated config with the host factory from the same bundle. */
  const bundle = await project.bundle(options.config)
  /** Config of the project. */
  const config = bundle.config
  /** Host factory sharing the config's plugin-host copy. */
  const createPartHost = bundle.createPartHost as (options: IPartHostOptions) => Promise<IPartHost>
  /** Configured plugins. */
  const configured = config.plugins as NonNullable<IPartHostOptions['plugins']>
  /** The project's DOM plugin, added when the config omits it so built-in modifiers exist. */
  const dom = bundle.domPlugin as NonNullable<IPartHostOptions['plugins']>[number]
  /** Host without a renderer for static checks. */
  const host = await createPartHost({
    plugins: configured.some((plugin) => plugin.name === dom.name)
      ? configured
      : [dom, ...configured],
    onError: () => undefined
  })
  /** All issues. */
  const issues: IIssue[] = []
  /** Rendered statuses. */
  const rendered: IRenderedStatus[] = []
  /** Blueprints without errors, eligible for rendered checks. */
  const clean: unknown[] = []
  try {
    for (const file of project.blueprintFiles(config)) {
      /** Blueprint document. */
      const document = JSON.parse(readFileSync(file, 'utf8')) as { readonly id: string }
      /** Static result, or the issue recorded for a load that threw. */
      const result = await loadOrIssue(host, document)
      issues.push(...result.issues)
      if (result.tree === undefined)
        rendered.push({
          blueprintId: document.id,
          status: 'skipped',
          reason: result.threw ? LOAD_ERROR : STATIC_ERRORS
        })
      else clean.push(document)
    }
  } finally {
    await host.dispose()
  }
  if (options.rendered && clean.length > 0) {
    /** Check page. */
    const harness = await Harness.open(project, project.configPath(options.config), options.browser)
    try {
      for (const blueprint of clean) {
        issues.push(...(await checkRendered(harness, blueprint, options.only)))
        rendered.push({ blueprintId: (blueprint as { id: string }).id, status: 'checked' })
      }
    } finally {
      await harness.close()
    }
  }
  return { issues, rendered }
}

/**
 * Loads one blueprint. A thrown parse or expansion error becomes one `doctor.load` error issue with
 * the error on `cause`, so the remaining blueprints are still checked.
 */
async function loadOrIssue(
  host: IPartHost,
  document: { readonly id: string }
): Promise<{
  readonly issues: readonly IIssue[]
  readonly tree: unknown
  readonly threw: boolean
}> {
  try {
    /** Load result. */
    const result = await host.blueprint.load(document)
    return { issues: result.issues, tree: result.tree, threw: false }
  } catch (cause) {
    /** Code of the thrown error. */
    const code = (cause as { code?: unknown } | undefined)?.code
    return {
      tree: undefined,
      threw: true,
      issues: [
        {
          address: document.id,
          facet: '',
          path: '',
          code: typeof code === 'string' ? code : LOAD_FALLBACK_CODE,
          rule: LOAD_RULE,
          messageKey: LOAD_RULE,
          severity: 'error',
          cause
        }
      ]
    }
  }
}

/** Mounts one blueprint in the page, runs pattern checks and layer invariants. */
async function checkRendered(
  harness: Harness,
  blueprint: unknown,
  only: string | undefined
): Promise<IIssue[]> {
  /** Page of the harness. */
  const page = harness.page
  /** Tree targets reported by the page after mounting. */
  const tree = (await page.evaluate(mountInPage, blueprint)) as IResolvedNode
  /** Targets of the tree. */
  const targets = {
    patterns: [] as ITargets['patterns'][number][],
    layers: [] as ITargets['layers'][number][]
  }
  collectTargets(tree, targets)
  /** Issues found. */
  const issues: IIssue[] = []
  /** Whether an address is inside the `--only` subtree. */
  const selected = (address: string): boolean =>
    only === undefined || address === only || address.startsWith(`${only}/`)
  for (const target of targets.patterns.filter((entry) => selected(entry.address))) {
    /** Problems reported by checkPattern. */
    const problems = (await page.evaluate(patternInPage, [target.address, target.pattern] as [
      string,
      string
    ])) as string[]
    for (const problem of problems)
      issues.push(
        renderedIssue(target.address, 'rendered.pattern', problem, `APG ${target.pattern}`)
      )
  }
  for (const target of targets.layers.filter((entry) => selected(entry.address))) {
    /** Invariant problems after opening. */
    const opened = (await page.evaluate(openInPage, [target.address, target.path] as [
      string,
      string
    ])) as string[]
    await page.keyboard.press('Escape')
    await page.waitForTimeout(50)
    /** Invariant problems after closing. */
    const closed = (await page.evaluate(closedInPage, target.address)) as string[]
    for (const problem of [...opened, ...closed])
      issues.push(renderedIssue(target.address, 'rendered.invariant', problem, 'page invariant'))
  }
  await page.evaluate(unmountInPage)
  return issues
}

/** Page-side globals of the check page. */
type IPage = {
  __partom: {
    config: { plugins: { name?: string }[] }
    createPartHost(options: unknown): Promise<IPartHost>
    domPlugin: { name?: string }
    reactPlugin: { name?: string }
    checkPattern(root: Element, pattern: string): Promise<void>
    focusProblems(phase: string): string[]
  }
  __partomHost?: IPartHost
  __partomContainer?: HTMLElement
}

/** Page side: creates a host, loads and mounts a blueprint, returns the resolved root. */
async function mountInPage(blueprint: unknown): Promise<unknown> {
  /** Page globals. */
  const page = window as unknown as IPage
  /** Config plugins without duplicates of the DOM and React plugins. */
  const plugins = page.__partom.config.plugins.filter(
    (plugin) => plugin.name !== 'part-dom' && plugin.name !== 'part-react'
  )
  /** Host of this blueprint. */
  const host = await page.__partom.createPartHost({
    plugins: [page.__partom.domPlugin, page.__partom.reactPlugin, ...plugins]
  })
  /** Loaded tree. */
  const loaded = await host.blueprint.load(blueprint)
  /** Mount container. */
  const container = document.createElement('div')
  document.body.append(container)
  host.mount(container, loaded.blueprintId)
  page.__partomHost = host
  page.__partomContainer = container
  await new Promise((resolve) => setTimeout(resolve, 50))
  return JSON.parse(
    JSON.stringify(loaded.tree?.root, (key, value: unknown) =>
      key === 'definition' ? { descriptor: (value as { descriptor: unknown }).descriptor } : value
    )
  )
}

/** Page side: runs checkPattern on the element of an address and returns problem lines. */
async function patternInPage([address, pattern]: [string, string]): Promise<string[]> {
  /** Element of the address. */
  const element = document.querySelector(`[data-part-address="${CSS.escape(address)}"]`)
  if (element === null) return [`no element rendered for ${address}`]
  try {
    await (window as unknown as IPage).__partom.checkPattern(element, pattern)
    return []
  } catch (error) {
    return String((error as Error).message)
      .split('\n')
      .slice(1)
      .map((line) => line.replace(/^- /, ''))
  }
}

/** Page side: focuses the first control, opens the part through its state, and checks invariants. */
async function openInPage([_address, path]: [string, string]): Promise<string[]> {
  /** Page globals. */
  const page = window as unknown as IPage
  page.__partomContainer?.querySelector<HTMLElement>('button, input, [tabindex="0"]')?.focus()
  page.__partomHost?.state.write(path, true)
  await new Promise((resolve) => setTimeout(resolve, 50))
  /** Problems: focus and dangling id references. */
  const problems = page.__partom.focusProblems('opening')
  for (const element of document.querySelectorAll(
    '[aria-controls], [aria-labelledby], [aria-describedby]'
  ))
    for (const name of ['aria-controls', 'aria-labelledby', 'aria-describedby'])
      for (const id of (element.getAttribute(name) ?? '').split(/\s+/).filter(Boolean))
        if (document.getElementById(id) === null)
          problems.push(`${name} points at "${id}", which is not in the page`)
  return problems
}

/** Page side: invariants after closing. */
function closedInPage(): string[] {
  return (window as unknown as IPage).__partom.focusProblems('closing')
}

/** Page side: unmounts and disposes the host of the last blueprint. */
async function unmountInPage(): Promise<void> {
  /** Page globals. */
  const page = window as unknown as IPage
  await page.__partomHost?.dispose()
  page.__partomContainer?.remove()
}

/** Formats a doctor result as text. */
export function formatText(result: IDoctorResult): string {
  /** Output lines. */
  const lines = result.issues.map(
    (issue) =>
      `${issue.severity} ${issue.rule} at ${issue.address}${issue.basis === undefined ? '' : ` (${issue.basis})`}: ${issue.messageKey}`
  )
  for (const status of result.rendered)
    lines.push(
      `rendered ${status.blueprintId}: ${status.status}${status.reason === undefined ? '' : ` (${status.reason})`}`
    )
  return lines.join('\n')
}

/** Formats a doctor result as JSON with causes reduced to four fields. */
export function formatJson(result: IDoctorResult): string {
  return JSON.stringify({
    issues: result.issues.map((issue) =>
      issue.cause === undefined ? issue : { ...issue, cause: serializeCause(issue.cause) }
    ),
    rendered: result.rendered
  })
}
