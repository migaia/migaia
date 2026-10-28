import { term, snapshotStorageRdfTerm } from '@migaia/storage-host/sdk'
import { RdfTermType, type IRdfBindingTerm, type ISparqlRow } from '@migaia/storage-contract'
import { sparqlError } from './errors.ts'
import { SparqlErrorCode } from '@migaia/storage-contract/error-code'
import { SparqlErrorText } from './error-text.ts'
/** Invalid native protocol fields stay on the response family rather than becoming user arguments. */
function malformed(): never {
  throw new TypeError(SparqlErrorText.responseInvalid)
}
/** A JSON binding is one raw RDF term; unbound variables are absent bindings. */
function binding(value: unknown): IRdfBindingTerm {
  if (!value || typeof value !== 'object') return malformed()
  /** Only actual native SPARQL binding fields enter canonical term validation. */
  const item = value as {
    type?: unknown
    value?: unknown
    datatype?: unknown
    'xml:lang'?: unknown
  }
  if (typeof item.value !== 'string') return malformed()
  if (item.type === 'uri') return term.iri(item.value)
  if (item.type === 'bnode')
    return snapshotStorageRdfTerm(
      { termType: RdfTermType.blankNode, value: item.value },
      undefined
    ) as IRdfBindingTerm
  if (item.type === 'literal' || item.type === 'typed-literal') {
    if (item['xml:lang'] !== undefined) {
      if (typeof item['xml:lang'] !== 'string') return malformed()
      /**
       * A native literal keeps its declared datatype/language combination during canonical
       * conversion.
       */
      const literal = term.literal(item.value, { language: item['xml:lang'] })
      return item.datatype === undefined
        ? literal
        : (snapshotStorageRdfTerm(
            { ...literal, datatype: item.datatype as string },
            undefined
          ) as IRdfBindingTerm)
    }
    if (item.datatype !== undefined && typeof item.datatype !== 'string') return malformed()
    return term.literal(
      item.value,
      item.datatype === undefined ? undefined : { datatype: item.datatype }
    )
  }
  return malformed()
}
/** One parser handles SELECT and ASK without fabricating native response semantics. */
export function parseSparqlResults(text: string, kind: 'select'): readonly ISparqlRow[]
export function parseSparqlResults(text: string, kind: 'ask'): boolean
export function parseSparqlResults(
  text: string,
  kind: 'select' | 'ask'
): readonly ISparqlRow[] | boolean {
  try {
    /** One real native response is parsed before its public result shape is admitted. */
    const result = JSON.parse(text) as {
      head?: { vars?: unknown }
      results?: { bindings?: unknown }
      boolean?: unknown
    }
    if (!result || typeof result !== 'object') return malformed()
    if (kind === 'ask') {
      if (typeof result.boolean !== 'boolean') return malformed()
      return result.boolean
    }
    /** The declared SELECT variables constrain which native bindings become public row properties. */
    const variables = result.head?.vars,
      rows = result.results?.bindings
    if (
      !Array.isArray(variables) ||
      !variables.every((name) => typeof name === 'string') ||
      !Array.isArray(rows)
    )
      return malformed()
    return rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return malformed()
      return Object.fromEntries(
        variables.map((name) => [name, Object.hasOwn(row, name) ? binding(row[name]) : undefined])
      )
    })
  } catch (cause) {
    throw sparqlError(SparqlErrorCode.responseInvalid, cause)
  }
}
