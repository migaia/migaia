export function canonicalJson(value: unknown): string
export function digestProvenanceSubject(subject: unknown): string
export function sizeTuple(emitted: {
  readonly moduleCount: number
  readonly rawBytes: number
  readonly gzipBytes: number
}): {
  readonly moduleCount: number
  readonly rawBytes: number
  readonly gzipBytes: number
}
export function validateAuthorization(
  authorization: unknown,
  subject: { readonly digest: string },
  options?: {
    readonly oldTuple?: unknown
    readonly newTuple?: unknown
    readonly authority?: {
      readonly schema: string
      readonly algorithm: string
      readonly authorityId: string
      readonly keyId: string
      readonly publicKeyPem: string
      readonly decisionId: string
      readonly payloadDigest: string
    }
  }
): string | null
