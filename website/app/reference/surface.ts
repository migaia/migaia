/**
 * Instance-surface resolution shared by the docs route (rendering) and the reference audit
 * (coverage). Both must agree on which members a page shows, so the logic lives here once.
 */
import type { IApiMember, IApiSymbol } from '../content-contract.js'

/** One resolved instance surface: its members plus composed bases not available on this page. */
export type IInstanceSurface = {
  readonly members: readonly IApiMember[]
  /** Names of every declaration merged into the surface, root first. */
  readonly owners: readonly string[]
  /** Composed types whose declarations are not loaded; shown as links. */
  readonly bases: readonly string[]
}

/**
 * Resolves a class or object-shaped type into its whole instance surface: its own members plus the
 * members of every composed base whose declaration is available. Bases that are not loaded stay as
 * links, so nothing inherited silently disappears.
 */
export function instanceSurface(
  root: IApiSymbol,
  symbols: readonly IApiSymbol[]
): IInstanceSurface {
  const members: IApiMember[] = []
  const bases: string[] = []
  const owners: string[] = []
  /** Declarations already merged; guards recursive and diamond-shaped compositions. */
  const seen = new Set<string>()
  /** Member signatures already listed, so a re-declared member appears once. */
  const signatures = new Set<string>()
  /** A nearer declaration owns a member name; its inherited optional version must not reappear. */
  const shadowed = new Set<string>()
  /** Adds one owner's overloads before marking its names as overrides of inherited members. */
  const visit = (symbol: IApiSymbol) => {
    if (seen.has(symbol.name)) return
    seen.add(symbol.name)
    owners.push(symbol.name)
    for (const member of symbol.members)
      if (!shadowed.has(member.name) && !signatures.has(member.signature)) {
        signatures.add(member.signature)
        members.push(member)
      }
    for (const member of symbol.members) shadowed.add(member.name)
    for (const base of symbol.composes ?? []) {
      /** Same-page declaration that carries its own members; compact projections carry none. */
      const declaration = symbols.find(
        (candidate) =>
          candidate.name === base &&
          (candidate.kind === 'type' ||
            candidate.kind === 'interface' ||
            candidate.kind === 'class') &&
          (candidate.members.length > 0 || (candidate.composes?.length ?? 0) > 0)
      )
      if (declaration) visit(declaration)
      else if (!bases.includes(base)) bases.push(base)
    }
  }
  visit(root)
  return { members, owners, bases }
}

/**
 * Lists the instance types a factory or function returns (`createEventChannel` returns a channel)
 * with their resolved surfaces, in the order they appear in the declared result.
 */
export function returnedInstances(
  symbol: IApiSymbol,
  symbols: readonly IApiSymbol[]
): readonly { readonly type: IApiSymbol; readonly surface: IInstanceSurface }[] {
  if (symbol.kind === 'class' || symbol.kind === 'type' || symbol.kind === 'interface') return []
  /** Declared result, including constants typed as arrow functions. */
  const result = callableShape(symbol)?.returns ?? symbol.returns
  /** Head type of each union/intersection member, not the generic arguments inside it. */
  const names = Array.from(new Set(resultHeads(result)))
  /** Member signatures already shown; a union of variants lists each distinct surface once. */
  const shown = new Set<string>()
  return names.flatMap((name) => {
    const type = symbols.find(
      (candidate) =>
        candidate.name === name &&
        (candidate.kind === 'type' || candidate.kind === 'interface' || candidate.kind === 'class')
    )
    if (!type) return []
    const surface = instanceSurface(type, symbols)
    if (surface.members.every((member) => shown.has(member.signature))) return []
    for (const member of surface.members) shown.add(member.signature)
    return [{ type, surface }]
  })
}

/**
 * Names the types a caller actually holds from a declared result: `Promise<IHandle>` gives
 * `IHandle`, `IA | IB` gives both, `ILoggerPlugin<IExt, IConfig>` gives only `ILoggerPlugin`.
 * Generic arguments are configuration or type plumbing, not the returned instance, so they are
 * never reported (a plugin factory must not present its config type as "the returned instance").
 */
export function resultHeads(result: string): readonly string[] {
  /** Result text with transparent wrappers removed. */
  let text = result.trim()
  for (;;) {
    const unwrapped = text.match(/^(?:Promise|PromiseLike|Readonly)<([\s\S]*)>$/)?.[1]
    if (!unwrapped) break
    text = unwrapped.trim()
  }
  /** Top-level members split on `|` and `&` outside brackets. */
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '<' || character === '{' || character === '(' || character === '[') depth += 1
    else if (
      (character === '>' && text[index - 1] !== '=') ||
      character === '}' ||
      character === ')' ||
      character === ']'
    )
      depth -= 1
    else if ((character === '|' || character === '&') && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.flatMap((part) => {
    const head = part.trim().match(/^(?:readonly\s+)?([A-Z][\w$]*)/)?.[1]
    return head ? [head] : []
  })
}

/** One literal member of an enum-like constant object, read from its generated declaration. */
export type IConstantMember = {
  readonly key: string
  readonly value: string
  readonly description?: string
}

/**
 * Extracts the literal members of an enum-like `const` (error codes, kinds, policies). Returns an
 * empty list unless every top-level member is a string, number, or boolean literal.
 */
export function constantMembers(symbol: IApiSymbol): readonly IConstantMember[] {
  if (symbol.kind !== 'const') return []
  /** Object body of the single declaration, with surrounding `{ }` removed. */
  const declaration = symbol.signature.split(/\n(?=export\s)/)[0] ?? symbol.signature
  const body = declaration.match(
    /^\s*export declare const [\w$]+: (?:Readonly<)?\{([\s\S]*)\}(?:>)?;?\s*$/
  )?.[1]
  if (!body) return []
  /** Body without comments; any remaining brace means a nested shape this list cannot show. */
  const bare = body.replace(/\/\*\*[\s\S]*?\*\//g, '')
  if (/[{}]/.test(bare)) return []
  /** One member: optional JSDoc, a readonly key, and its literal value. */
  const pattern =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?readonly ([\w$]+|"[^"]*"|'[^']*'): ("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false);/g
  const members = [...body.matchAll(pattern)].map((match) => ({
    key: match[2]!.replace(/^["']|["']$/g, ''),
    value: match[3]!,
    // Generated signatures are whitespace-collapsed, so JSDoc line stars sit inline: drop any
    // standalone `*` run, then normalize spacing.
    description: match[1]
      ?.replace(/(?:^|\s)\*+(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }))
  return members.length === (bare.match(/\breadonly\b/g) ?? []).length ? members : []
}

/** Strips quotes from a generated literal (`"queued"` → `queued`). */
export function literalText(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

/**
 * Allowed literal values of a field type: the literals of a literal union (`'a' | 'b'`), or the
 * values of an enum-like constant the type names (`IEventDispatchPolicy` / `EventDispatchPolicy`).
 * Returns `undefined` for types that are not a closed literal set.
 */
export function fieldLiteralValues(
  type: string,
  symbols: readonly IApiSymbol[]
): { readonly values: readonly string[]; readonly enumName?: string } | undefined {
  const trimmed = type.replace(/\s+/g, ' ').trim()
  if (/^(['"][^'"]*['"])(\s*\|\s*['"][^'"]*['"])+$/.test(trimmed))
    return { values: trimmed.split('|').map((part) => literalText(part.trim())) }
  /** `IFoo`, `Foo`, `(typeof Foo)[keyof typeof Foo]` or `keyof typeof Foo` naming a constant. */
  const name =
    trimmed.match(/^I?([A-Z][\w$]*)$/)?.[1] ??
    trimmed.match(/typeof ([A-Z][\w$]*)/)?.[1] ??
    undefined
  if (!name) return undefined
  const constant = symbols.find(
    (candidate) => candidate.name === name && candidate.kind === 'const'
  )
  const members = constant ? constantMembers(constant) : []
  if (members.length === 0) return undefined
  /** `keyof typeof X` selects keys; every other form selects values. */
  const byKey =
    trimmed.startsWith('keyof typeof') ||
    members.every((member) => literalText(member.value) === member.key)
  return {
    values: members.map((member) => (byKey ? member.key : literalText(member.value))),
    enumName: name
  }
}

/** Parameters and result of a callable runtime symbol. */
export type ICallableShape = Readonly<{
  parameters: readonly Readonly<{ name: string; type: string; optional: boolean }>[]
  returns: string
}>

/** Splits a parameter or argument list on top-level commas. */
function topLevelParts(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const [index, character] of Array.from(text).entries()) {
    if ('([{<'.includes(character)) depth += 1
    /** The `>` of an arrow `=>` does not close a generic bracket. */ else if (
      ')]}'.includes(character) ||
      (character === '>' && text[index - 1] !== '=')
    )
      depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += character
  }
  if (current.trim()) parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/**
 * Reads the callable shape of a runtime symbol: declared functions (overload parameters merged by
 * name, first declaration first) and constants typed as arrow functions (`export declare const x:
 * <T>(a: A) => R`). Returns `undefined` for non-callable symbols.
 */
export function callableShape(symbol: IApiSymbol): ICallableShape | undefined {
  if (symbol.kind === 'class') return { parameters: symbol.parameterDetails, returns: symbol.name }
  if (symbol.kind === 'function' || (symbol.kind === 'const' && symbol.callable)) {
    /** Parameter names already listed; overloads repeat the options bag. */
    const seen = new Set<string>()
    return {
      parameters: symbol.parameterDetails.filter((parameter) => {
        if (seen.has(parameter.name)) return false
        seen.add(parameter.name)
        return true
      }),
      returns: symbol.returns
    }
  }
  if (symbol.kind !== 'const') return undefined
  const declaration = symbol.signature.match(
    /^\s*export declare const [\w$]+: ([\s\S]*?);?\s*$/
  )?.[1]
  if (!declaration) return undefined
  let rest = declaration.trim()
  if (rest.startsWith('<')) {
    /** Skip the generic parameter list. */
    let depth = 0
    let index = 0
    for (; index < rest.length; index += 1) {
      if (rest[index] === '<') depth += 1
      else if (rest[index] === '>' && rest[index - 1] !== '=') depth -= 1
      if (depth === 0) break
    }
    rest = rest.slice(index + 1).trim()
  }
  if (!rest.startsWith('(')) return undefined
  /** End of the parameter list at the matching parenthesis. */
  let depth = 0
  let end = 0
  for (; end < rest.length; end += 1) {
    if (rest[end] === '(') depth += 1
    else if (rest[end] === ')') depth -= 1
    if (depth === 0) break
  }
  const after = rest.slice(end + 1).trim()
  if (!after.startsWith('=>')) return undefined
  return {
    parameters: topLevelParts(rest.slice(1, end)).map((part) => {
      const match = part.match(/^(?:\.\.\.)?([\w$]+)(\?)?\s*:\s*([\s\S]+)$/)
      return {
        name: match?.[1] ?? part,
        type: match?.[3]?.trim() ?? 'unknown',
        optional: Boolean(match?.[2])
      }
    }),
    returns: after.slice(2).trim()
  }
}

/**
 * Resolves the doc of a (possibly nested) options field such as `execution.mutationTimeoutMs`:
 * first a doc keyed by the full path on `typeName`, then, for `head.rest`, the declared type of
 * member `head` (each named type it mentions) is searched for `rest`. Shared by the audit and the
 * renderer so both see the same field docs.
 */
export function resolveFieldDoc<TDoc>(
  typeName: string,
  path: string,
  membersOf: (typeName: string) => Readonly<Record<string, TDoc>> | undefined,
  symbols: readonly IApiSymbol[],
  seen: ReadonlySet<string> = new Set()
): TDoc | undefined {
  if (seen.has(typeName)) return undefined
  const direct = membersOf(typeName)?.[path]
  if (direct !== undefined) return direct
  const dot = path.indexOf('.')
  if (dot < 0) return undefined
  const head = path.slice(0, dot)
  const rest = path.slice(dot + 1)
  /** Declaration of the containing type; its member `head` names the nested type. */
  const declaration = symbols.find((symbol) => symbol.name === typeName)
  const member = declaration
    ? instanceSurface(declaration, symbols).members.find((candidate) => candidate.name === head)
    : undefined
  const nextSeen = new Set(seen).add(typeName)
  for (const nested of member?.returns.match(/\b[A-Z][\w$]*\b/g) ?? []) {
    const doc = resolveFieldDoc(nested, rest, membersOf, symbols, nextSeen)
    if (doc !== undefined) return doc
  }
  return undefined
}
