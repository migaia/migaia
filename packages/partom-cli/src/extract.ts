import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { parseSync } from 'oxc-parser'
import { PartCliErrorCode } from './error-code.ts'
import { createPartCliError, PartCliText } from './errors.ts'

/** Identifier grammar accepted into generated code. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
/** Event prop grammar: `on` followed by an upper-case letter. */
const EVENT_PROP = /^on[A-Z]/

/** One extracted component. */
export type IExtractedComponent = {
  readonly component: string
  readonly file: string
  readonly partId: string
  readonly props: readonly string[]
  readonly variants: Readonly<Record<string, readonly string[]>>
  readonly defaults: Readonly<Record<string, string>>
  readonly events: Readonly<Record<string, string>>
  readonly slots: readonly string[]
  readonly pattern?: string
  readonly basis?: string
  readonly uncertain: readonly string[]
  readonly mapping: {
    readonly props?: Readonly<Record<string, string>>
    readonly events?: Readonly<Record<string, string>>
  }
}

/** Generic ESTree node view. */
type INode = { readonly type: string; readonly [key: string]: unknown }

/** True for an ESTree node object. */
function isNode(value: unknown): value is INode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/** Visits every node once in depth-first order. */
function walk(node: unknown, visit: (node: INode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (!isNode(node)) return
  visit(node)
  for (const value of Object.values(node))
    if (typeof value === 'object' && value !== null) walk(value, visit)
}

/** Key text of a property or type member. */
function keyOf(node: INode): string | undefined {
  /** Key node. */
  const key = node.key as INode | undefined
  if (key === undefined) return undefined
  if (key.type === 'Identifier') return String(key.name)
  if (key.type === 'Literal') return String(key.value)
  return undefined
}

/** Facts gathered from one source file in a single walk. */
type IFileFacts = {
  readonly imports: Set<string>
  readonly components: string[]
  readonly variants: Record<string, string[]>
  readonly defaults: Record<string, string>
  readonly typeMembers: Map<string, string[]>
  readonly paramMembers: Map<string, string[]>
  readonly usesChildren: { value: boolean }
}

/** Collects variants and defaults from a `cva(base, { variants, defaultVariants })` call. */
function readCva(call: INode, facts: IFileFacts): void {
  /** Second argument. */
  const options = (call.arguments as INode[] | undefined)?.[1]
  for (const property of (options?.properties as INode[] | undefined) ?? []) {
    /** Property name. */
    const name = keyOf(property)
    /** Object value. */
    const value = property.value as INode
    if (name === 'variants')
      for (const group of (value.properties as INode[] | undefined) ?? [])
        facts.variants[keyOf(group) ?? ''] = ((group.value as INode).properties as INode[]).map(
          (option) => keyOf(option) ?? ''
        )
    if (name === 'defaultVariants')
      for (const entry of (value.properties as INode[] | undefined) ?? [])
        facts.defaults[keyOf(entry) ?? ''] = String((entry.value as INode).value)
  }
}

/** Member names of a type literal, or of the literal members of an intersection. */
function literalMembers(type: INode | undefined): string[] {
  if (type === undefined) return []
  if (type.type === 'TSTypeLiteral')
    return ((type.members as INode[]) ?? []).map((member) => keyOf(member) ?? '').filter(Boolean)
  if (type.type === 'TSIntersectionType')
    return ((type.types as INode[]) ?? []).flatMap((part) => literalMembers(part))
  return []
}

/** Records one node's facts. */
function record(node: INode, facts: IFileFacts): void {
  if (node.type === 'ImportDeclaration') facts.imports.add(String((node.source as INode).value))
  if (node.type === 'CallExpression' && (node.callee as INode).name === 'cva') readCva(node, facts)
  if (node.type === 'TSTypeAliasDeclaration')
    facts.typeMembers.set(
      String((node.id as INode).name),
      literalMembers(node.typeAnnotation as INode)
    )
  if (node.type === 'Identifier' && node.name === 'children') facts.usesChildren.value = true
  if (
    node.type === 'FunctionDeclaration' &&
    isNode(node.id) &&
    /^[A-Z]/.test(String(node.id.name))
  ) {
    /** First parameter. */
    const param = (node.params as INode[])[0]
    /** Annotated parameter type. */
    const annotation = (param?.typeAnnotation as INode | undefined)?.typeAnnotation as
      | INode
      | undefined
    /** Member names from a referenced alias or an inline literal. */
    const members =
      annotation?.type === 'TSTypeReference'
        ? [`@ref:${String((annotation.typeName as INode).name)}`]
        : [
            ...literalMembers(annotation),
            ...(param?.type === 'ObjectPattern'
              ? ((param.properties as INode[]) ?? []).map((p) => keyOf(p) ?? '')
              : [])
          ]
    facts.paramMembers.set(String(node.id.name), members)
  }
  if (node.type === 'ExportNamedDeclaration') {
    /** Declared function, if any. */
    const declaration = node.declaration as INode | null
    if (declaration?.type === 'FunctionDeclaration' && isNode(declaration.id))
      facts.components.push(String(declaration.id.name))
    for (const specifier of (node.specifiers as INode[]) ?? []) {
      /** Exported name. */
      const name = String((specifier.exported as INode).name)
      if (/^[A-Z]/.test(name)) facts.components.push(name)
    }
  }
}

/** Pattern guessed from imported primitives, with its basis. */
function patternOf(imports: ReadonlySet<string>): {
  readonly pattern?: string
  readonly basis?: string
} {
  if (imports.has('@radix-ui/react-dialog'))
    return { pattern: 'dialog', basis: 'imports @radix-ui/react-dialog' }
  if (imports.has('@radix-ui/react-tabs'))
    return { pattern: 'tabs', basis: 'imports @radix-ui/react-tabs' }
  if (imports.has('@radix-ui/react-popover') && imports.has('cmdk'))
    return { pattern: 'combobox', basis: 'imports @radix-ui/react-popover and cmdk' }
  return {}
}

/** Kebab-case part name of a component. */
function partName(component: string): string {
  return component.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** Extracts every exported component of one file; parse errors are PARSE_FAILED. */
export function extractFile(file: string): IExtractedComponent[] {
  /** Source text. */
  const source = readFileSync(file, 'utf8')
  /** Parse result. */
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0)
    throw createPartCliError(
      PartCliErrorCode.parseFailed,
      PartCliText.parseFailed(file),
      parsed.errors
    )
  /** Facts of the file. */
  const facts: IFileFacts = {
    imports: new Set(),
    components: [],
    variants: {},
    defaults: {},
    typeMembers: new Map(),
    paramMembers: new Map(),
    usesChildren: { value: false }
  }
  walk(parsed.program, (node) => record(node, facts))
  /** Pattern guess shared by components of the file. */
  const guess = patternOf(facts.imports)
  return facts.components.map((component) => describeComponent(file, component, facts, guess))
}

/** Builds the extracted description of one component. */
function describeComponent(
  file: string,
  component: string,
  facts: IFileFacts,
  guess: { readonly pattern?: string; readonly basis?: string }
): IExtractedComponent {
  /** Raw member names, following one alias reference. */
  const raw = (facts.paramMembers.get(component) ?? []).flatMap((name) =>
    name.startsWith('@ref:') ? (facts.typeMembers.get(name.slice(5)) ?? []) : [name]
  )
  /** Uncertain items for the report. */
  const uncertain: string[] = []
  /** Accepted prop names. */
  const props = new Set<string>(Object.keys(facts.variants).filter((name) => IDENTIFIER.test(name)))
  /** Events keyed by canonical name. */
  const events: Record<string, string> = {}
  for (const name of raw) {
    if (!IDENTIFIER.test(name)) {
      uncertain.push(`prop "${name}" is not an identifier`)
      continue
    }
    if (EVENT_PROP.test(name)) events[name.charAt(2).toLowerCase() + name.slice(3)] = name
    else props.add(name)
  }
  if (raw.length === 0 && Object.keys(facts.variants).length === 0)
    uncertain.push('props type could not be determined syntactically')
  return {
    component,
    file,
    partId: `${partName(component)}@1`,
    props: [...props],
    variants: facts.variants,
    defaults: facts.defaults,
    events,
    slots: facts.usesChildren.value ? ['children'] : [],
    ...guess,
    uncertain,
    mapping: Object.keys(events).length === 0 ? {} : { events }
  }
}

/** Writes one draft module per component and the report; strings are emitted as JSON literals. */
export function writeDrafts(components: readonly IExtractedComponent[], outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  for (const entry of components) {
    if (!IDENTIFIER.test(entry.component)) continue
    /** Import path of the component from the draft. */
    const from = relative(resolve(outDir), resolve(entry.file))
    /** Part spec fields. */
    const spec = {
      id: entry.partId,
      ...(entry.pattern === undefined
        ? {}
        : { behavior: { semantics: { pattern: entry.pattern } } }),
      ...(Object.keys(entry.events).length === 0
        ? {}
        : {
            events: Object.fromEntries(
              Object.keys(entry.events).map((name) => [name, { kind: 'component' }])
            )
          }),
      editor: { variants: entry.variants, defaults: entry.defaults }
    }
    /** Variable prefix. */
    const name = entry.component.charAt(0).toLowerCase() + entry.component.slice(1)
    writeFileSync(
      join(outDir, `${partName(entry.component)}.part.ts`),
      [
        "import { definePart } from '@migaia/part-host'",
        "import { bindReactComponent } from '@migaia/part-plugin-react'",
        `import { ${entry.component} } from ${JSON.stringify(from.startsWith('.') ? from : `./${from}`)}`,
        '',
        `export const ${name}Part = definePart(${JSON.stringify(spec, null, 2)})`,
        `export const ${name}Binding = bindReactComponent(${name}Part, ${entry.component}, ${JSON.stringify(entry.mapping)})`,
        ''
      ].join('\n')
    )
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ components }, null, 2))
}

/** Reads a previously written report. */
export function readReport(outDir: string): IExtractedComponent[] {
  return (
    JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as {
      components: IExtractedComponent[]
    }
  ).components
}

/** File name used in messages. */
export function shortName(file: string): string {
  return basename(file)
}
