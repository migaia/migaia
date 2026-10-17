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
