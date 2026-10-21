/**
 * Executable form of the rules declared in `contract.ts`. `scripts/audit/reference.ts` runs
 * `auditLibrary()` against the generated manifest; the result lists every gap with its rule id.
 * Keep each check here, next to its rule id, so the rule text and its enforcement cannot drift.
 */
import type { IApiMember, IApiSymbol } from '../content-contract.js'
import type {
  ICode,
  IEnumDoc,
  ILibraryReference,
  IMemberDoc,
  IOptionCaseDoc,
  ISymbolDoc,
  IText,
  ITypeDoc
} from './contract.js'
import {
  callableShape,
  constantMembers,
  fieldLiteralValues,
  instanceSurface,
  resolveFieldDoc,
  returnedInstances
} from './surface.js'

/** One audit finding: rule id, location and what is missing or wrong. */
export type IFinding = Readonly<{ rule: string; where: string; message: string }>

/** One generated module projection as stored in the library manifest. */
export type IManifestModule = Readonly<{ module: string; symbols: readonly IApiSymbol[] }>

/** Minimum Chinese characters of a summary-like text (`TXT-DEPTH`). */
const MIN_ZH_SUMMARY = 10
/** Minimum characters of an English summary-like text (`TXT-DEPTH`). */
const MIN_EN_SUMMARY = 24
/** Minimum Chinese characters of a parameter, value, default or returns text (`TXT-DEPTH`). */
const MIN_ZH_DETAIL = 4

/** Removes backticked identifiers, URLs and code-like tokens before a language check. */
function proseOnly(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w$]+\([^)]*\)/g, ' ')
}

/** Counts CJK characters. */
function cjkLength(text: string): number {
  return (text.match(/[㐀-鿿]/g) ?? []).length
}

/**
 * Checks one bilingual text: `TXT-ZH`, `TXT-EN`, `TXT-NO-STUB`, and `TXT-DEPTH` with the given
 * minimum Chinese length.
 */
export function checkText(
  text: IText | undefined,
  where: string,
  minimumZh: number,
  subject?: string
): IFinding[] {
  if (!text) return [{ rule: 'REF-MISSING', where, message: 'text is missing' }]
  const findings: IFinding[] = []
  /** English prose run of four or more words outside backticks. */
  const englishRun = proseOnly(text.zh).match(/[A-Za-z][\w'-]*(?:[ ,]+[A-Za-z][\w'-]*){3,}/)
  if (englishRun)
    findings.push({ rule: 'TXT-ZH', where, message: `English prose in zh: "${englishRun[0]}"` })
  if (cjkLength(text.zh) === 0)
    findings.push({ rule: 'TXT-ZH', where, message: 'zh text has no Chinese' })
  if (/[㐀-鿿]/.test(text.en))
    findings.push({ rule: 'TXT-EN', where, message: 'CJK characters in en text' })
  for (const [locale, value] of Object.entries(text))
    if (/\bTODO\b|\bTBD\b|待补充|\/\*\s*\.\.\.\s*\*\/|^\s*\.\.\.\s*$/.test(value))
      findings.push({ rule: 'TXT-NO-STUB', where, message: `placeholder in ${locale}` })
  if (cjkLength(text.zh) < minimumZh)
    findings.push({
      rule: 'TXT-DEPTH',
      where,
      message: `zh text too short (${cjkLength(text.zh)} < ${minimumZh} Chinese characters)`
    })
  if (minimumZh >= MIN_ZH_SUMMARY && text.en.trim().length < MIN_EN_SUMMARY)
    findings.push({ rule: 'TXT-DEPTH', where, message: 'en text too short' })
  if (subject && text.zh.replace(/[`。.\s]/g, '') === subject)
    findings.push({ rule: 'TXT-DEPTH', where, message: 'text only restates the name' })
  return findings
}

/** `CODE-ZH`: a shared example may not carry English prose comments. */
export function checkCode(code: ICode | undefined, where: string, required: boolean): IFinding[] {
  if (code === undefined)
    return required ? [{ rule: 'REF-MEMBER', where, message: 'example is missing' }] : []
  if (typeof code !== 'string') {
    /** Comments of the zh variant must be Chinese or identifiers only. */
    const comments = code.zh.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []
    return comments
      .filter((comment) => /[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){2,}/.test(proseOnly(comment)))
      .map((comment) => ({
        rule: 'CODE-ZH',
        where,
        message: `English comment in zh example: ${comment.slice(0, 60)}`
      }))
  }
  const comments = code.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []
  return comments
    .filter((comment) => /[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){2,}/.test(proseOnly(comment)))
    .map((comment) => ({
      rule: 'CODE-ZH',
      where,
      message: `shared example has an English comment; use { en, zh }: ${comment.slice(0, 60)}`
    }))
}

/** Reads a keyed doc, preferring the module-qualified key. */
function keyed<T>(
  record: Readonly<Record<string, T>>,
  module: string,
  name: string
): T | undefined {
  return record[`${module}:${name}`] ?? record[name]
}

/** Finds the member doc for one surface member: root type first, then composed owners. */
export function memberDocFor(
  reference: ILibraryReference,
  module: string,
  owners: readonly string[],
  member: string
): IMemberDoc | undefined {
  for (const owner of owners) {
    const doc = keyed(reference.types, module, owner)?.members[member]
    if (doc) return doc
  }
  return undefined
}

/**
 * `TXT-ORIGIN`: a parameter or field that carries an identifier the reader must obtain somewhere
 * (`taskId`, `subscriptionKey`, `leaseToken`, `pluginHandle`) must say where that value comes from:
 * which API returns it, which callback receives it, or who issues it. Matches camelCase names
 * ending in `Id`, `Key`, `Token`, `Handle` or `Lease`; bare `id` / `key` are plain inputs.
 */
const ORIGIN_NAME = /^[a-z][A-Za-z0-9]*(?:Id|Key|Token|Handle|Lease)s?$/
/** Words that name a value's source in each locale. */
const ORIGIN_EN =
  /\b(?:from|returned|returns|issued|generated|assigned|given (?:at|by|in)|set (?:at|by|in)|received)\b/i
const ORIGIN_ZH = /来自|返回|生成|分配|签发|取自|收到|由 ?`|订阅时|登记时|指定|给出/

/** Checks that an identifier-like parameter or field explains where its value comes from. */
function checkOrigin(name: string, text: IText | undefined, where: string): IFinding[] {
  if (!text || !ORIGIN_NAME.test(name)) return []
  if (ORIGIN_EN.test(text.en) && ORIGIN_ZH.test(text.zh)) return []
  return [{ rule: 'TXT-ORIGIN', where, message: `${name}: say where the value comes from` }]
}

/** `REF-MEMBER`: checks the doc of one member. */
function checkMember(
  member: IApiMember,
  doc: IMemberDoc | undefined,
  where: string,
  instance: boolean
): IFinding[] {
  if (!doc) return [{ rule: 'REF-MEMBER', where, message: 'member is not documented' }]
  const findings = checkText(doc.summary, `${where}.summary`, MIN_ZH_SUMMARY, member.name)
  if (member.kind === 'method') {
    for (const parameter of member.parameterDetails)
      findings.push(
        ...checkText(doc.params?.[parameter.name], `${where}(${parameter.name})`, MIN_ZH_DETAIL),
        ...checkOrigin(parameter.name, doc.params?.[parameter.name], `${where}(${parameter.name})`)
      )
    findings.push(...checkText(doc.returns, `${where}.returns`, MIN_ZH_DETAIL))
    findings.push(...checkCode(doc.example, `${where}.example`, instance))
  }
  return findings
}

/**
 * `REF-OPTION-CODE`: every options field is shown in code, by its own example or by an option case
 * that lists it and spells its name. Literal-union, enum and function fields need their own example
 * and `whenToUse`, because their effect depends on the value the reader picks.
 */
function checkOptionCode(
  symbol: IApiSymbol,
  fieldDocs: ReadonlyMap<string, IMemberDoc | undefined>,
  cases: readonly IOptionCaseDoc[],
  where: string,
  symbols: readonly IApiSymbol[]
): IFinding[] {
  const findings: IFinding[] = []
  cases.forEach((item, index) => {
    const at = `${where}.optionCases[${index}]`
    findings.push(
      ...checkText(item.title, `${at}.title`, MIN_ZH_DETAIL),
      ...checkText(item.problem, `${at}.problem`, MIN_ZH_DETAIL),
      ...checkText(item.result, `${at}.result`, MIN_ZH_DETAIL),
      ...checkCode(item.example, `${at}.example`, true)
    )
    /** Every code variant must spell each covered field, so the claim is visible in the code. */
    const variants =
      typeof item.example === 'string' ? [item.example] : [item.example.en, item.example.zh]
    for (const name of item.covers) {
      const leaf = name.split('.').at(-1) ?? name
      if (!symbol.configuration.some((field) => field.name === name))
        findings.push({
          rule: 'REF-OPTION-CODE',
          where: at,
          message: `covers unknown field ${name}`
        })
      else if (!variants.every((code) => new RegExp(`\\b${leaf}\\b`).test(code)))
        findings.push({ rule: 'REF-OPTION-CODE', where: at, message: `example never sets ${name}` })
    }
  })
  /** Field names some case covers. */
  const covered = new Set(cases.flatMap((item) => item.covers))
  for (const field of symbol.configuration) {
    const doc = fieldDocs.get(field.name)
    if (!doc) continue
    const at = `${where}{${field.name}}`
    const top = field.name.split('.')[0]!
    const needsOwn =
      Boolean(fieldLiteralValues(field.type, symbols)) ||
      Boolean(doc.values) ||
      /=>/.test(field.type)
    if (needsOwn) {
      if (!doc.example)
        findings.push({
          rule: 'REF-OPTION-CODE',
          where: at,
          message: 'value-dependent field has no own example'
        })
      if (!doc.whenToUse)
        findings.push({
          rule: 'REF-OPTION-CODE',
          where: at,
          message: 'value-dependent field has no whenToUse'
        })
      else findings.push(...checkText(doc.whenToUse, `${at}.whenToUse`, MIN_ZH_DETAIL))
      continue
    }
    const parentExample = top !== field.name && fieldDocs.get(top)?.example
    if (!doc.example && !parentExample && !covered.has(field.name) && !covered.has(top))
      findings.push({
        rule: 'REF-OPTION-CODE',
        where: at,
        message: 'field is not shown in any example or option case'
      })
  }
  return findings
}

/** `REF-OPTION`: checks one options field. */
function checkOption(
  field: IApiSymbol['configuration'][number],
  doc: IMemberDoc | undefined,
  where: string,
  symbols: readonly IApiSymbol[],
  reference: ILibraryReference
): IFinding[] {
  if (!doc) return [{ rule: 'REF-OPTION', where, message: 'option is not documented' }]
  const findings = checkText(doc.summary, `${where}.summary`, MIN_ZH_SUMMARY, field.name)
  findings.push(...checkOrigin(field.name.split('.').at(-1) ?? field.name, doc.summary, where))
  if (field.optional) {
    if (!doc.default)
      findings.push({ rule: 'REF-OPTION', where, message: 'optional field has no default' })
    else findings.push(...checkText(doc.default, `${where}.default`, MIN_ZH_DETAIL))
  }
  const literal = fieldLiteralValues(field.type, symbols)
  if (literal) {
    if (!doc.values)
      findings.push({
        rule: 'REF-OPTION',
        where,
        message: `allowed values not explained: ${literal.values.join(', ')}`
      })
    else if ('enum' in doc.values) {
      const enumDoc = reference.enums[doc.values.enum as string]
      if (!enumDoc)
        findings.push({
          rule: 'REF-ENUM',
          where,
          message: `enum ${doc.values.enum} not documented`
        })
    } else {
      const valueDocs = doc.values as Readonly<Record<string, IText>>
      for (const value of literal.values)
        findings.push(...checkText(valueDocs[value], `${where}=${value}`, MIN_ZH_DETAIL))
    }
  }
  return findings
}

/**
 * Construction cycle step 6: a method of an instance type that returns another type of this library
 * with methods (a handle, a controller, a batcher) makes that type an instance as well, so it needs
 * scenarios, an example and member examples. Plain data shapes (no methods) stay data. Grows
 * `instanceTypes` in place until no new type is reached.
 */
function closeInstanceTypes(instanceTypes: Set<string>, symbols: readonly IApiSymbol[]): void {
  /** Library declarations that can own members. */
  const typeNamed = (name: string) =>
    symbols.find(
      (candidate) =>
        candidate.name === name &&
        (candidate.kind === 'type' || candidate.kind === 'interface' || candidate.kind === 'class')
    )
  /** Instance types whose method results have not been followed yet. */
  const pending = [...instanceTypes]
  while (pending.length > 0) {
    const type = typeNamed(pending.pop() as string)
    if (!type) continue
    for (const member of instanceSurface(type, symbols).members) {
      if (member.kind !== 'method') continue
      for (const name of new Set(member.returns.match(/\b[A-Z][\w$]*\b/g) ?? [])) {
        const target = typeNamed(name)
        if (!target || instanceTypes.has(name)) continue
        if (
          !instanceSurface(target, symbols).members.some((candidate) => candidate.kind === 'method')
        )
          continue
        instanceTypes.add(name)
        pending.push(name)
      }
    }
  }
}

/** Checks one runtime symbol and everything its page shows. */
function checkSymbol(
  api: IManifestModule,
  symbol: IApiSymbol,
  reference: ILibraryReference,
  instanceTypes: Set<string>,
  symbols: readonly IApiSymbol[]
): IFinding[] {
  const where = `${api.module}:${symbol.name}`
  const doc: ISymbolDoc | undefined = keyed(reference.symbols, api.module, symbol.name)
  if (!doc) return [{ rule: 'REF-SYMBOL', where, message: 'runtime symbol is not documented' }]
  const findings = checkText(doc.purpose, `${where}.purpose`, MIN_ZH_SUMMARY * 2, symbol.name)
  const shape = callableShape(symbol)
  if (shape) {
    /** The options bag is documented field by field; other parameters need a text each. */
    const optionsParameter = symbol.configuration.length > 0 ? 'options' : undefined
    for (const parameter of shape.parameters)
      if (parameter.name !== optionsParameter || (!doc.options && !doc.optionDocs))
        findings.push(
          ...checkText(doc.params?.[parameter.name], `${where}(${parameter.name})`, MIN_ZH_DETAIL),
          ...checkOrigin(
            parameter.name,
            doc.params?.[parameter.name],
            `${where}(${parameter.name})`
          )
        )
    if (!/^(?:void|Promise<void>)$/.test(shape.returns.trim()))
      findings.push(...checkText(doc.returns, `${where}.returns`, MIN_ZH_DETAIL))
  }
  /** Field docs by field name, read once for the per-field and the code-coverage checks. */
  const fieldDocs = new Map<string, IMemberDoc | undefined>()
  for (const field of symbol.configuration) {
    const fieldDoc =
      doc.optionDocs?.[field.name] ??
      (doc.options
        ? resolveFieldDoc(
            doc.options,
            field.name,
            (name) => keyed(reference.types, api.module, name)?.members,
            api.symbols
          )
        : undefined)
    fieldDocs.set(field.name, fieldDoc)
    findings.push(
      ...checkOption(field, fieldDoc, `${where}{${field.name}}`, api.symbols, reference)
    )
  }
  if (symbol.configuration.length > 0) {
    /** The API's own cases win; otherwise the options type supplies them. */
    const cases =
      doc.optionCases ??
      (doc.options ? keyed(reference.types, api.module, doc.options)?.optionCases : undefined) ??
      []
    findings.push(...checkOptionCode(symbol, fieldDocs, cases, where, api.symbols))
  }
  if (constantMembers(symbol).length > 0) {
    const enumDoc: IEnumDoc | undefined = reference.enums[symbol.name]
    if (!enumDoc) findings.push({ rule: 'REF-ENUM', where, message: 'enum is not documented' })
    else {
      findings.push(...checkText(enumDoc.summary, `${where}.summary`, MIN_ZH_SUMMARY))
      for (const member of constantMembers(symbol))
        findings.push(
          ...checkText(enumDoc.values[member.key], `${where}.${member.key}`, MIN_ZH_SUMMARY)
        )
    }
  }
  if (doc.role === 'enhancer') {
    const enhancer = reference.enhancers[symbol.name]
    if (!enhancer) findings.push({ rule: 'REF-ENHANCER', where, message: 'enhancer guide missing' })
    else {
      findings.push(...checkText(enhancer.summary, `${where}.enhancer.summary`, MIN_ZH_SUMMARY * 2))
      findings.push(...checkCode(enhancer.install, `${where}.enhancer.install`, true))
      findings.push(...checkCode(enhancer.example, `${where}.enhancer.example`, true))
      enhancer.scenarios.forEach((scenario, index) =>
        findings.push(...checkText(scenario, `${where}.enhancer.scenario${index}`, MIN_ZH_DETAIL))
      )
      ;(enhancer.behaviors ?? []).forEach((behavior, index) =>
        findings.push(...checkText(behavior, `${where}.enhancer.behavior${index}`, MIN_ZH_DETAIL))
      )
      for (const grant of enhancer.grants) {
        const at = `${where}.enhancer[${grant.signature}]`
        findings.push(...checkText(grant.summary, `${at}.summary`, MIN_ZH_SUMMARY))
        for (const [name, text] of Object.entries(grant.params ?? {}))
          findings.push(...checkText(text, `${at}(${name})`, MIN_ZH_DETAIL))
        if (grant.returns)
          findings.push(...checkText(grant.returns, `${at}.returns`, MIN_ZH_DETAIL))
        findings.push(...checkCode(grant.example, `${at}.example`, false))
      }
      if (enhancer.grants.length === 0 && (enhancer.behaviors ?? []).length === 0)
        findings.push({
          rule: 'REF-ENHANCER',
          where,
          message: 'enhancer grants no API and no behavior'
        })
    }
  }
  /** Factories and classes show the instance they produce: those types need instance docs. */
  const surfaceName = doc && keyed(reference.types, api.module, symbol.name)?.surface
  for (const { type } of returnedInstances(symbol, symbols)) instanceTypes.add(type.name)
  if (symbol.kind === 'class') instanceTypes.add(symbol.name)
  if (surfaceName) instanceTypes.add(surfaceName)
  findings.push(...checkCode(doc.example, `${where}.example`, false))
  for (const [index, text] of (doc.scenarios ?? []).entries())
    findings.push(...checkText(text, `${where}.scenario${index}`, MIN_ZH_DETAIL))
  for (const [index, text] of (doc.avoid ?? []).entries())
    findings.push(...checkText(text, `${where}.avoid${index}`, MIN_ZH_DETAIL))
  return findings
}

/** Checks one type, interface or class surface. */
function checkType(
  api: IManifestModule,
  symbol: IApiSymbol,
  reference: ILibraryReference,
  instance: boolean,
  symbols: readonly IApiSymbol[]
): IFinding[] {
  const where = `${api.module}:${symbol.name}`
  const doc: ITypeDoc | undefined = keyed(reference.types, api.module, symbol.name)
  if (!doc) return [{ rule: 'REF-TYPE', where, message: 'type is not documented' }]
  const findings = checkText(doc.summary, `${where}.summary`, MIN_ZH_SUMMARY, symbol.name)
  if (instance) {
    if (!doc.scenarios?.length)
      findings.push({ rule: 'REF-TYPE', where, message: 'instance type has no scenarios' })
    findings.push(...checkCode(doc.example, `${where}.example`, true))
  }
  for (const [index, text] of (doc.scenarios ?? []).entries())
    findings.push(...checkText(text, `${where}.scenario${index}`, MIN_ZH_DETAIL))
  const surface = instanceSurface(symbol, symbols)
  /** Member names already checked; overloads share one doc. */
  const checked = new Set<string>()
  for (const member of surface.members) {
    if (checked.has(member.name)) continue
    checked.add(member.name)
    findings.push(
      ...checkMember(
        member,
        memberDocFor(reference, api.module, surface.owners, member.name),
        `${where}.${member.name}`,
        instance
      )
    )
    const doc = memberDocFor(reference, api.module, surface.owners, member.name)
    const literal = fieldLiteralValues(member.returns, api.symbols)
    if (doc && literal && member.kind === 'property' && !doc.values && !instance)
      findings.push({
        rule: 'REF-OPTION',
        where: `${where}.${member.name}`,
        message: `allowed values not explained: ${literal.values.join(', ')}`
      })
  }
  return findings
}

/** Chinese words that mark a sentence as describing a required or recommended partner API. */
const PAIR_ZH = /搭配|配合|配套|一起使用|联用|结合使用|成对使用|调用后才|才会生效|才生效/
/** Backticked identifier, optionally qualified (`runtime.flush`) or called (`flush()`). */
const BACKTICKED = /`([A-Za-z_$][\w$.]*)(?:\(\))?`/g

/** Code text of an example in both locales, for name lookups. */
function codeText(code: ICode | undefined): string {
  if (code === undefined) return ''
  return typeof code === 'string' ? code : `${code.en}\n${code.zh}`
}

/**
 * `REF-PAIRED`: a text that says this API is used together with another API of the library must
 * name that partner in backticks, and the example of this API must call at least one partner named
 * in that sentence, so the reader sees the combination instead of a lone call. `texts` are the
 * prose of one documentation node; `example` is its own example (or the owning type's example for a
 * property).
 */
function checkPairing(
  self: string,
  texts: readonly (IText | undefined)[],
  example: ICode | undefined,
  names: ReadonlySet<string>,
  where: string
): IFinding[] {
  const findings: IFinding[] = []
  const code = codeText(example)
  for (const text of texts) {
    if (!text) continue
    for (const sentence of text.zh.split(/[。；;\n]/)) {
      if (!PAIR_ZH.test(sentence)) continue
      const partners = [...sentence.matchAll(BACKTICKED)]
        .map((match) => (match[1] as string).split('.').at(-1) as string)
        .filter((name) => name !== self && names.has(name))
      if (partners.length === 0) {
        findings.push({
          rule: 'REF-PAIRED',
          where,
          message: `pairing sentence names no partner API in backticks: ${sentence.slice(0, 40)}`
        })
        continue
      }
      if (!partners.some((name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(code)))
        findings.push({
          rule: 'REF-PAIRED',
          where,
          message: `example does not show the pairing with ${partners.map((name) => `\`${name}\``).join(' / ')}`
        })
    }
  }
  return findings
}

/** Runs `REF-PAIRED` over every documented symbol, type member and enhancer grant. */
function checkPairings(reference: ILibraryReference, names: ReadonlySet<string>): IFinding[] {
  /** Name without the `module:` qualifier. */
  const bare = (key: string) => key.split(':').at(-1) as string
  const findings: IFinding[] = []
  for (const [key, doc] of Object.entries(reference.symbols))
    findings.push(
      ...checkPairing(
        bare(key),
        [doc.purpose, doc.returns, ...Object.values(doc.params ?? {}), ...(doc.scenarios ?? [])],
        doc.example,
        names,
        key
      )
    )
  for (const [key, doc] of Object.entries(reference.types)) {
    findings.push(
      ...checkPairing(bare(key), [doc.summary, ...(doc.scenarios ?? [])], doc.example, names, key)
    )
    for (const [member, memberDoc] of Object.entries(doc.members))
      findings.push(
        ...checkPairing(
          member,
          [
            memberDoc.summary,
            memberDoc.whenToUse,
            memberDoc.returns,
            ...Object.values(memberDoc.params ?? {})
          ],
          memberDoc.example ?? doc.example,
          names,
          `${key}.${member}`
        )
      )
  }
  for (const [key, enhancer] of Object.entries(reference.enhancers))
    for (const grant of enhancer.grants)
      findings.push(
        ...checkPairing(
          grant.signature.match(/([A-Za-z_$][\w$]*)\s*[(<]/)?.[1] ?? grant.signature,
          [grant.summary, grant.returns, ...Object.values(grant.params ?? {})],
          grant.example,
          names,
          `${key}.enhancer[${grant.signature}]`
        )
      )
  return findings
}

/** Runs every coverage and text rule for one library. */
export function auditLibrary(
  modules: readonly IManifestModule[],
  reference: ILibraryReference
): IFinding[] {
  const findings: IFinding[] = []
  for (const api of modules) {
    const moduleDoc = reference.modules[api.module]
    if (!moduleDoc)
      findings.push({
        rule: 'REF-MODULE',
        where: api.module,
        message: 'entry point is not documented'
      })
    else {
      findings.push(...checkText(moduleDoc.summary, `${api.module}.summary`, MIN_ZH_SUMMARY * 2))
      findings.push(...checkCode(moduleDoc.example, `${api.module}.example`, false))
    }
  }
  /** Types shown as returned instances or class surfaces; they need scenarios and examples. */
  const instanceTypes = new Set<string>()
  /** A public factory can return a type exported by another entry in this same library. */
  const symbols = modules.flatMap((api) => api.symbols)
  for (const api of modules)
    for (const symbol of api.symbols)
      if (symbol.kind !== 'type' && symbol.kind !== 'interface')
        findings.push(
          ...checkSymbol(api, symbol, reference, instanceTypes, [...api.symbols, ...symbols])
        )
  closeInstanceTypes(
    instanceTypes,
    modules.flatMap((api) => api.symbols)
  )
  for (const api of modules)
    for (const symbol of api.symbols)
      if (symbol.kind === 'type' || symbol.kind === 'interface' || symbol.kind === 'class')
        findings.push(
          ...checkType(api, symbol, reference, instanceTypes.has(symbol.name), [
            ...api.symbols,
            ...symbols
          ])
        )
  /** Exported names and member names a pairing sentence may point to. */
  const partnerNames = new Set<string>()
  for (const api of modules)
    for (const symbol of api.symbols) {
      partnerNames.add(symbol.name)
      for (const member of instanceSurface(symbol, api.symbols).members)
        partnerNames.add(member.name)
    }
  for (const doc of Object.values(reference.types))
    for (const member of Object.keys(doc.members)) partnerNames.add(member)
  findings.push(...checkPairings(reference, partnerNames))
  /** Documented names that no longer exist are stale and must be removed. */
  const names = new Set(
    modules.flatMap((api) =>
      api.symbols.flatMap((symbol) => [symbol.name, `${api.module}:${symbol.name}`])
    )
  )
  for (const api of modules) names.add(`module:${api.module}`)
  for (const key of Object.keys(reference.modules))
    if (!names.has(`module:${key}`))
      findings.push({
        rule: 'REF-STALE',
        where: `modules.${key}`,
        message: 'documents an entry point the manifest does not have'
      })
  for (const [group, record] of [
    ['symbols', reference.symbols],
    ['types', reference.types],
    ['enums', reference.enums],
    ['enhancers', reference.enhancers]
  ] as const)
    for (const key of Object.keys(record))
      if (!names.has(key))
        findings.push({
          rule: 'REF-STALE',
          where: `${group}.${key}`,
          message: 'documents a name the manifest does not export'
        })
  return findings
}
