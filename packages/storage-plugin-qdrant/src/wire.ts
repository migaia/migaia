import { QdrantWireField } from './constants.ts'

/** The supported runtimes expose standard raw JSON tokens without changing numeric values. */
type IQdrantJson = typeof JSON & { rawJSON(value: string): unknown }

/**
 * Keep multivectors distinct from Qdrant's integer sparse tuple during native JSON encoding.
 * Payload and filter data keep their original representation; dense vectors and sparse indices
 * remain ordinary numbers. The returned copy belongs only to the outgoing transport request.
 */
export function qdrantWireValue(value: unknown, vector = false): unknown {
  if (Array.isArray(value)) {
    if (
      vector &&
      value.length > 0 &&
      value.every(
        (row) => Array.isArray(row) && row.every((component) => typeof component === 'number')
      )
    )
      return value.map((row: number[]) =>
        row.map((component) => {
          if (!Number.isFinite(component)) return component
          /** Exponent and decimal tokens already select Qdrant's floating-point representation. */
          const token = String(component)
          return (JSON as IQdrantJson).rawJSON(/[.eE]/.test(token) ? token : token + '.0')
        })
      )
    return value.map((child) => qdrantWireValue(child, vector))
  }
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        !Array.isArray(child) && (key === QdrantWireField.payload || key === QdrantWireField.filter)
          ? child
          : qdrantWireValue(
              child,
              vector ||
                key === QdrantWireField.vector ||
                key === QdrantWireField.vectors ||
                key === QdrantWireField.query
            )
      ])
    )
  return value
}
