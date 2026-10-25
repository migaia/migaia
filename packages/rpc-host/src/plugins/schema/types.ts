/** A synchronous acceptance parser keeps the caller's original application value unchanged. */
export type IRpcSchemaParser<T = unknown> = Readonly<{
  parse(value: unknown): T
}>

/** Input and successful result validation retain the original public parser option shape. */
export type IRpcMethodValidators = Readonly<{
  params: IRpcSchemaParser
  result: IRpcSchemaParser
}>

/** Parser state belongs to this installed plugin; method metadata in handshakes stays inert. */
export type IRpcSchemaOptions = Readonly<{
  schemas?: Readonly<Record<string, IRpcMethodValidators>>
  namespaces?: readonly string[]
}>
