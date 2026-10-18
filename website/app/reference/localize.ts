/**
 * Projects an audited library reference into one page locale. Pages of audited libraries render
 * only these strings: no English fallback on Chinese pages and no sentence truncation.
 */
import type {
  EnhancerKind,
  ICode,
  IEnhancerDoc,
  ILibraryReference,
  IMemberDoc,
  IText,
  ITypeDoc,
  SymbolRole
} from './contract.js'
import type { IApiSymbol } from '../content-contract.js'

/** Page locale of the reference projection. */
export type IReferenceLocale = 'en' | 'zh'

/**
 * One allowed value of a field with its meaning. `constant` is set when the value comes from an
 * enum-like constant: then `value` is the constant key and the page shows the literal next to it.
 */
export type ILocalizedValue = Readonly<{ value: string; meaning: string; constant?: string }>

/** Member doc projected into the page locale. */
export type ILocalizedMemberDoc = Readonly<{
  summary: string
  params: Readonly<Record<string, string>>
  returns?: string
  default?: string
  values: readonly ILocalizedValue[]
  whenToUse?: string
  example?: string
}>

/** Type doc projected into the page locale. */
export type ILocalizedTypeDoc = Readonly<{
  surface?: string
  summary: string
  scenarios: readonly string[]
  example?: string
  members: Readonly<Record<string, ILocalizedMemberDoc>>
}>

/** Runtime symbol doc projected into the page locale. */
export type ILocalizedSymbolDoc = Readonly<{
  role: SymbolRole
  purpose: string
  params: Readonly<Record<string, string>>
  returns?: string
  /** Field docs of an anonymous options bag (`optionDocs`). */
  options: Readonly<Record<string, ILocalizedMemberDoc>>
  /** Named options type whose member docs (resolved through nested types) document the table. */
  optionsType?: string
  example?: string
  exampleIntro?: string
  exampleResult?: string
  scenarios: readonly string[]
  avoid: readonly string[]
}>

/** Granted API projected into the page locale. */
export type ILocalizedGrantDoc = ILocalizedMemberDoc & Readonly<{ signature: string }>

/** Enhancer doc projected into the page locale. */
export type ILocalizedEnhancerDoc = Readonly<{
  kind: EnhancerKind
  target: string
  summary: string
  install: string
  grants: readonly ILocalizedGrantDoc[]
  behaviors: readonly string[]
  scenarios: readonly string[]
  example: string
}>

/** Enum doc projected into the page locale. */
export type ILocalizedEnumDoc = Readonly<{
  summary: string
  values: Readonly<Record<string, string>>
}>

/** Entry point doc projected into the page locale. */
export type ILocalizedModuleDoc = Readonly<{ summary: string; example?: string }>

/** Page-ready reference of one audited library. */
export type ILocalizedReference = Readonly<{
  modules: Readonly<Record<string, ILocalizedModuleDoc>>
  symbols: Readonly<Record<string, ILocalizedSymbolDoc>>
  types: Readonly<Record<string, ILocalizedTypeDoc>>
  enums: Readonly<Record<string, ILocalizedEnumDoc>>
  enhancers: Readonly<Record<string, ILocalizedEnhancerDoc>>
}>

/** Reads one text in the page locale. */
function text(value: IText, locale: IReferenceLocale): string {
  return value[locale]
}

/** Reads one example in the page locale. */
function code(value: ICode | undefined, locale: IReferenceLocale): string | undefined {
  return value === undefined ? undefined : typeof value === 'string' ? value : value[locale]
}

/** Projects one member doc; `enum` value references resolve through the library's enum docs. */
function member(
  doc: IMemberDoc,
  reference: ILibraryReference,
  locale: IReferenceLocale
): ILocalizedMemberDoc {
  /** Allowed values with meanings, in declaration order of the doc. */
  const values: ILocalizedValue[] = []
  if (doc.values && 'enum' in doc.values) {
    const enumDoc = reference.enums[doc.values.enum as string]
    for (const [value, meaning] of Object.entries(enumDoc?.values ?? {}))
      values.push({ value, meaning: text(meaning, locale), constant: doc.values.enum as string })
  } else
    for (const [value, meaning] of Object.entries((doc.values ?? {}) as Record<string, IText>))
      values.push({ value, meaning: text(meaning, locale) })
  return {
    summary: text(doc.summary, locale),
    params: Object.fromEntries(
      Object.entries(doc.params ?? {}).map(([name, value]) => [name, text(value, locale)])
    ),
    returns: doc.returns && text(doc.returns, locale),
    default: doc.default && text(doc.default, locale),
    values,
    whenToUse: doc.whenToUse && text(doc.whenToUse, locale),
    example: code(doc.example, locale)
  }
}

/** Projects one type doc. */
function typeDoc(
  doc: ITypeDoc,
  reference: ILibraryReference,
  locale: IReferenceLocale
): ILocalizedTypeDoc {
  return {
    surface: doc.surface,
    summary: text(doc.summary, locale),
    scenarios: (doc.scenarios ?? []).map((value) => text(value, locale)),
    example: code(doc.example, locale),
    members: Object.fromEntries(
      Object.entries(doc.members).map(([name, value]) => [name, member(value, reference, locale)])
    )
  }
}

/** Projects one enhancer doc. */
function enhancer(
  doc: IEnhancerDoc,
  reference: ILibraryReference,
  locale: IReferenceLocale
): ILocalizedEnhancerDoc {
  return {
    kind: doc.kind,
    target: doc.target,
    summary: text(doc.summary, locale),
    install: code(doc.install, locale)!,
    grants: doc.grants.map((grant) => ({
      ...member(grant, reference, locale),
      signature: grant.signature
    })),
    behaviors: (doc.behaviors ?? []).map((value) => text(value, locale)),
    scenarios: doc.scenarios.map((value) => text(value, locale)),
    example: code(doc.example, locale)!
  }
}

/** Projects a whole library reference into one locale. */
export function localizeReference(
  reference: ILibraryReference,
  locale: IReferenceLocale
): ILocalizedReference {
  return {
    modules: Object.fromEntries(
      Object.entries(reference.modules).map(([name, doc]) => [
        name,
        { summary: text(doc.summary, locale), example: code(doc.example, locale) }
      ])
    ),
    symbols: Object.fromEntries(
      Object.entries(reference.symbols).map(([name, doc]) => {
        /** Anonymous options bag; named options types resolve on the page (nested paths). */
        const optionDocs = doc.optionDocs ?? {}
        return [
          name,
          {
            role: doc.role,
            purpose: text(doc.purpose, locale),
            params: Object.fromEntries(
              Object.entries(doc.params ?? {}).map(([key, value]) => [key, text(value, locale)])
            ),
            returns: doc.returns && text(doc.returns, locale),
            options: Object.fromEntries(
              Object.entries(optionDocs).map(([key, value]) => [
                key,
                member(value, reference, locale)
              ])
            ),
            optionsType: doc.options,
            example: code(doc.example, locale),
            exampleIntro: doc.exampleIntro && text(doc.exampleIntro, locale),
            exampleResult: doc.exampleResult && text(doc.exampleResult, locale),
            scenarios: (doc.scenarios ?? []).map((value) => text(value, locale)),
            avoid: (doc.avoid ?? []).map((value) => text(value, locale))
          }
        ]
      })
    ),
    types: Object.fromEntries(
      Object.entries(reference.types).map(([name, doc]) => [name, typeDoc(doc, reference, locale)])
    ),
    enums: Object.fromEntries(
      Object.entries(reference.enums).map(([name, doc]) => [
        name,
        {
          summary: text(doc.summary, locale),
          values: Object.fromEntries(
            Object.entries(doc.values).map(([key, value]) => [key, text(value, locale)])
          )
        }
      ])
    ),
    enhancers: Object.fromEntries(
      Object.entries(reference.enhancers).map(([name, doc]) => [
        name,
        enhancer(doc, reference, locale)
      ])
    )
  }
}

/** Identifier tokens in serialized manifest or doc text, used to follow type references. */
const IDENTIFIER = /[A-Za-z_$][\w$]*/g

/** Declaration fields that establish a type dependency; examples and prose do not add edges. */
type IReferenceDeclaration = Pick<
  IApiSymbol,
  'name' | 'signature' | 'returns' | 'parameterDetails' | 'composes'
>

/**
 * Cuts a localized library reference down to what one page renders, so a page's loader data (and
 * the copy inlined into its HTML for hydration) does not carry every other API's documentation. The
 * page keeps: its module doc; a purpose-only entry for every symbol of its module (listing and
 * links); full docs and enhancer guides for the selected symbol; and full docs for the types and
 * enums its own declaration names (options types, returned instances). Other runtime symbols the
 * declaration mentions keep only their listing entry, and types named in turn are not carried:
 * their own pages hold them, so one page never ships the library's whole reference graph.
 * `declarations` are the manifest symbols listed by the selected module; `roots` are the selected
 * symbol and type names (empty on a module page). `dependencies` also includes declarations from
 * sibling entries already projected for this page, so a root's directly named types resolve even
 * when a sibling entry declares them.
 */
export function pageReference(
  reference: ILocalizedReference,
  module: string,
  declarations: readonly IReferenceDeclaration[],
  roots: readonly string[],
  dependencies: readonly IReferenceDeclaration[] = declarations
): ILocalizedReference {
  /** Strips the `module:` qualifier so qualified and bare keys match one declaration name. */
  const bare = (key: string) => key.slice(key.lastIndexOf(':') + 1)
  /** Reference entries reached from the roots, by bare name. */
  const reached = new Set<string>()
  /** Names still to visit with their distance from a root; only roots are expanded. */
  const pending: Array<readonly [string, number]> = roots.map((name) => [name, 0])
  /** Every bare name the reference documents, so unrelated identifiers are ignored. */
  const documented = new Set(
    [reference.symbols, reference.types, reference.enums, reference.enhancers].flatMap((record) =>
      Object.keys(record).map(bare)
    )
  )
  while (pending.length > 0) {
    const [name, depth] = pending.pop()!
    if (reached.has(name)) continue
    reached.add(name)
    /** Composed bases own inherited members, so they expand with their declaring type. */
    const owners = dependencies.filter((declaration) => declaration.name === name)
    for (const declaration of owners)
      for (const base of declaration.composes ?? []) if (!reached.has(base)) pending.push([base, 1])
    if (depth > 0) continue
    /** Only actual declarations and authored type surfaces establish direct type references. */
    const texts = owners.flatMap((declaration) => [
      declaration.signature,
      declaration.returns,
      ...declaration.parameterDetails.map((parameter) => parameter.type)
    ])
    for (const [key, doc] of Object.entries(reference.symbols))
      if (bare(key) === name && doc.optionsType) texts.push(doc.optionsType)
    for (const [key, doc] of Object.entries(reference.types))
      if (bare(key) === name && doc.surface) texts.push(doc.surface)
    for (const text of texts)
      for (const token of text.match(IDENTIFIER) ?? [])
        if (documented.has(token) && !reached.has(token)) pending.push([token, depth + 1])
  }
  /** Names listed on the module page or in the module's symbol list. */
  const listed = new Set(declarations.map((declaration) => declaration.name))
  /** The selected symbol and type names themselves. */
  const rootNames = new Set(roots)
  /** Keeps full entries for the given names. */
  const full = <T>(record: Readonly<Record<string, T>>, names: ReadonlySet<string>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => names.has(bare(key))))
  return {
    modules: reference.modules[module] ? { [module]: reference.modules[module] } : {},
    symbols: Object.fromEntries(
      Object.entries(reference.symbols).flatMap(([key, doc]) =>
        rootNames.has(bare(key))
          ? [[key, doc]]
          : listed.has(bare(key))
            ? [
                [
                  key,
                  {
                    role: doc.role,
                    purpose: doc.purpose,
                    params: {},
                    options: {},
                    scenarios: [],
                    avoid: []
                  }
                ]
              ]
            : []
      )
    ),
    types: Object.fromEntries(
      Object.entries(reference.types).flatMap(([key, doc]) =>
        reached.has(bare(key))
          ? [[key, doc]]
          : listed.has(bare(key))
            ? [[key, { summary: doc.summary, scenarios: [], members: {} }]]
            : []
      )
    ),
    enums: full(reference.enums, reached),
    enhancers: full(reference.enhancers, rootNames)
  }
}
