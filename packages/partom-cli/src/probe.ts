import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IExtractedComponent } from './extract.ts'
import { Harness } from './harness.ts'
import type { Project } from './project.ts'

/** One rendered snapshot of a component with given props. */
export type IProbe = {
  readonly component: string
  readonly props: Readonly<Record<string, string>>
  readonly html: string
}

/** One verification difference. */
export type IDifference = {
  readonly component: string
  readonly original: string
  readonly viaHost: string
}

/** Extra page imports exposing the extracted components and React rendering helpers. */
function importsFor(components: readonly IExtractedComponent[]): string {
  /** Import lines. */
  const lines = [
    "import { createElement } from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import { definePart, definePartPlugin } from '@migaia/part-host'",
    "import { bindReactComponent } from '@migaia/part-plugin-react'"
  ]
  /** Window entries. */
  const entries: string[] = []
  components.forEach((entry, index) => {
    lines.push(
      `import { ${entry.component} as c${index} } from ${JSON.stringify(resolve(entry.file))}`
    )
    entries.push(`${JSON.stringify(entry.component)}: c${index}`)
  })
  lines.push(
    `window.__partomExtract = { createElement, createRoot, definePart, definePartPlugin, bindReactComponent, components: { ${entries.join(', ')} } }`
  )
  return lines.join('\n')
}

/** Props sets probed per component: one per variant value, linear in the number of values. */
function probeProps(entry: IExtractedComponent): Readonly<Record<string, string>>[] {
  /** Props sets. */
  const sets: Record<string, string>[] = [{}]
  for (const [name, values] of Object.entries(entry.variants))
    for (const value of values) sets.push({ [name]: value })
  return sets
}

/** Props used by verification: the first non-default value of each variant. */
function verifyProps(entry: IExtractedComponent): Readonly<Record<string, string>> {
  /** Chosen props. */
  const props: Record<string, string> = {}
  for (const [name, values] of Object.entries(entry.variants)) {
    /** First value differing from the default. */
    const value = values.find((candidate) => candidate !== entry.defaults[name]) ?? values[0]
    if (value !== undefined) props[name] = value
  }
  return props
}

/** Page side: renders a component with props and returns normalized HTML. */
async function renderOriginal([name, props]: [string, Record<string, string>]): Promise<string> {
  /** Page helpers. */
  const helpers = (window as unknown as { __partomExtract: IExtractHelpers }).__partomExtract
  /** Container. */
  const container = document.createElement('div')
  document.body.append(container)
  /** React root. */
  const root = helpers.createRoot(container)
  root.render(helpers.createElement(helpers.components[name], props))
  await new Promise((resolve) => setTimeout(resolve, 30))
  /** HTML before cleanup. */
  const html = container.innerHTML
  root.unmount()
  container.remove()
  return html.replace(/ (id|data-part-address)="[^"]*"/g, '')
}

/** Page side: renders a component through a part host with a mapping and returns normalized HTML. */
async function renderViaHost([name, partId, props, mapping]: [
  string,
  string,
  Record<string, string>,
  Record<string, unknown>
]): Promise<string> {
  /** Page globals. */
  const page = window as unknown as {
    __partomExtract: IExtractHelpers
    __partom: {
      createPartHost(o: unknown): Promise<IHostLike>
      domPlugin: unknown
      reactPlugin: unknown
    }
  }
  /** Helpers. */
  const helpers = page.__partomExtract
  /** Draft part. */
  const part = helpers.definePart({ id: partId })
  /** Plugin with the draft binding. */
  const plugin = helpers.definePartPlugin({
    name: 'verify',
    parts: [part],
    implementations: [helpers.bindReactComponent(part, helpers.components[name], mapping)]
  })
  /** Host. */
  const host = await page.__partom.createPartHost({
    plugins: [page.__partom.domPlugin, page.__partom.reactPlugin, plugin]
  })
  await host.blueprint.load({
    id: 'verify',
    version: 1,
    root: { tag: partId, id: 'v', facets: { props } }
  })
  /** Container. */
  const container = document.createElement('div')
  document.body.append(container)
  host.mount(container, 'verify')
  await new Promise((resolve) => setTimeout(resolve, 30))
  /** HTML before cleanup. */
  const html = container.innerHTML
  await host.dispose()
  container.remove()
  return html.replace(/ (id|data-part-address)="[^"]*"/g, '')
}

/** Helpers exposed by the extract page entry. */
type IExtractHelpers = {
  createElement(component: unknown, props: unknown): unknown
  createRoot(container: Element): { render(node: unknown): void; unmount(): void }
  definePart(spec: unknown): { readonly descriptor: unknown }
  definePartPlugin(spec: unknown): unknown
  bindReactComponent(part: unknown, component: unknown, mapping: unknown): unknown
  components: Record<string, unknown>
}

/** Minimal host surface used on the page. */
type IHostLike = {
  blueprint: { load(input: unknown): Promise<unknown> }
  mount(target: unknown, id: string): unknown
  dispose(): Promise<unknown>
}

/** Renders each component once per variant value and stores the snapshots in the report directory. */
export async function probe(
  project: Project,
  configPath: string,
  components: readonly IExtractedComponent[],
  outDir: string,
  browser: string | undefined
): Promise<readonly IProbe[]> {
  /** Check page with the components. */
  const harness = await Harness.open(project, configPath, browser, importsFor(components))
  /** Snapshots. */
  const probes: IProbe[] = []
  try {
    for (const entry of components)
      for (const props of probeProps(entry))
        probes.push({
          component: entry.component,
          props,
          html: (await harness.page.evaluate(renderOriginal, [entry.component, { ...props }] as [
            string,
            Record<string, string>
          ])) as string
        })
  } finally {
    await harness.close()
  }
  writeFileSync(join(outDir, 'probe.json'), JSON.stringify({ probes }, null, 2))
  return probes
}

/** Compares each component rendered directly and through a part host; returns the differences. */
export async function verify(
  project: Project,
  configPath: string,
  components: readonly IExtractedComponent[],
  browser: string | undefined
): Promise<readonly IDifference[]> {
  /** Check page with the components. */
  const harness = await Harness.open(project, configPath, browser, importsFor(components))
  /** Differences found. */
  const differences: IDifference[] = []
  try {
    for (const entry of components) {
      /** Props used for both renders. */
      const props = { ...verifyProps(entry) }
      /** Direct render. */
      const original = (await harness.page.evaluate(renderOriginal, [entry.component, props] as [
        string,
        Record<string, string>
      ])) as string
      /** Render through the host with the report's mapping. */
      const viaHost = (await harness.page.evaluate(renderViaHost, [
        entry.component,
        entry.partId,
        props,
        { ...entry.mapping }
      ] as [string, string, Record<string, string>, Record<string, unknown>])) as string
      if (original !== viaHost) differences.push({ component: entry.component, original, viaHost })
    }
  } finally {
    await harness.close()
  }
  return differences
}
