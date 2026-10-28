/** Iterator and plugin protocol admission captures callable methods before ownership. */
import type { ISerializePlugin, ISerializeParser } from './types.ts'
import { assertSerializeType } from './types.ts'
import { createSerializeTypeError, SerializeErrorCode, SerializeErrorText } from './errors.ts'
import { isSerializeTaggedError } from './operation-support.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'
/** A captured method invocation that retains the original protocol receiver. */
export type IInvokable<TResult> = (...args: never[]) => TResult

/** Immutable registry admission snapshot for one parser and its method receivers. */
export type IParserMethodsSnapshot = {
  readonly encode: ISerializeParser['encode']
  readonly decode: ISerializeParser['decode']
  readonly dispose: ISerializeParser['dispose']
}

/** Immutable registry admission snapshot for one plugin type and parser identity. */
export type IParserSnapshot = {
  readonly type: string
  readonly parser: ISerializeParser
} & IParserMethodsSnapshot

/** Snapshot plugin-list protocol state before reading any plugin or parser property. */
export const snapshotPluginList = (plugins: unknown): readonly ISerializePlugin[] => {
  try {
    if (plugins === null || (typeof plugins !== 'object' && typeof plugins !== 'function')) {
      throw new TypeError(SerializeErrorText.pluginListInvalid)
    }
    /** Original option or protocol receiver survives later caller mutation. */
    const receiver = plugins as object & {
      readonly length?: unknown
      readonly entries?: unknown
    }
    /** The list length bounds protocol consumption before inspecting any plugin. */
    const length = receiver.length
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      throw new TypeError(SerializeErrorText.pluginListInvalid)
    }
    if (length === 0) return []
    /** The list entries method is captured exactly once with its receiver. */
    const entries = receiver.entries
    if (typeof entries !== 'function') {
      throw new TypeError(SerializeErrorText.pluginListInvalid)
    }
    /** The acquired iterator is owned by this protocol admission or drain. */
    const iterator = Reflect.apply(entries as IInvokable<unknown>, receiver, [])
    if (iterator === null || (typeof iterator !== 'object' && typeof iterator !== 'function')) {
      throw new TypeError(SerializeErrorText.pluginListInvalid)
    }
    /** The iterator next method is captured once before advancing it. */
    const next = (iterator as { readonly next?: unknown }).next
    if (typeof next !== 'function') {
      throw new TypeError(SerializeErrorText.pluginListInvalid)
    }
    /** Admission stores only validated plugin-list entries for the constructor. */
    const snapshot: ISerializePlugin[] = []
    for (let index = 0; index < length; index += 1) {
      /** The next protocol result is checked before reading completion or payload. */
      const result = Reflect.apply(
        next as IInvokable<{ readonly done?: unknown; readonly value?: unknown }>,
        iterator,
        []
      )
      if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
        throw new TypeError(SerializeErrorText.pluginListInvalid)
      }
      if ((result as { readonly done?: unknown }).done) {
        throw new TypeError(SerializeErrorText.pluginListInvalid)
      }
      /** The entry must preserve the expected index and exact pair shape. */
      const entry = (result as { readonly value?: unknown }).value
      if (!Array.isArray(entry) || entry.length !== 2 || entry[0] !== index) {
        throw new TypeError(SerializeErrorText.pluginListInvalid)
      }
      snapshot.push(entry[1] as ISerializePlugin)
    }
    /** One final next call proves the declared list length matches its iterator. */
    const finalResult = Reflect.apply(next as IInvokable<{ readonly done?: unknown }>, iterator, [])
    if (
      finalResult === null ||
      (typeof finalResult !== 'object' && typeof finalResult !== 'function') ||
      !(finalResult as { readonly done?: unknown }).done
    ) {
      throw new TypeError(SerializeErrorText.pluginListInvalid)
    }
    return Object.freeze(snapshot)
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.pluginListInvalid,
      { cause: error }
    )
  }
}

/** Read one plugin/parser graph once before it becomes visible to a registry. */
export const snapshotPlugin = (
  plugin: ISerializePlugin,
  index: number,
  parserMethods: WeakMap<ISerializeParser, IParserMethodsSnapshot>
): IParserSnapshot => {
  try {
    /** Routing token is captured before parser properties are inspected. */
    const type = plugin.type
    if (typeof type !== 'string') throw new TypeError(SerializeDiagnosticText.pluginType(index))
    assertSerializeType(type)

    /** Parser identity is read once after routing-token admission. */
    const parserValue = plugin.parser
    if (parserValue === null || typeof parserValue !== 'object')
      throw new TypeError(SerializeDiagnosticText.pluginParser(type))
    /** Admitted parser identity remains the receiver of its captured methods. */
    const parser = parserValue as ISerializeParser
    /** Shared parser identities reuse one method snapshot across plugin types. */
    const cachedMethods = parserMethods.get(parser)
    if (cachedMethods !== undefined) return { type, parser, ...cachedMethods }
    /** Encode getter is captured once before the decode and disposal getters. */
    const encode = parser.encode
    /** Decode getter is captured once before optional disposal admission. */
    const decode = parser.decode
    /** Disposal getter is captured before any parser enters lifecycle ownership. */
    const dispose = parser.dispose
    if (typeof encode !== 'function' || typeof decode !== 'function')
      throw new TypeError(SerializeDiagnosticText.parserMethods(type))
    if (dispose !== undefined && typeof dispose !== 'function')
      throw new TypeError(SerializeDiagnosticText.parserDispose(type))
    /** The immutable method snapshot is shared only by this exact parser identity. */
    const methods = { encode, decode, dispose } satisfies IParserMethodsSnapshot
    parserMethods.set(parser, methods)
    return { type, parser, ...methods }
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeDiagnosticText.pluginInvalid(index),
      { cause: error }
    )
  }
}
