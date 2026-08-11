import {
  readSSRStateFromDocument as readInjectedSSRState,
  readSSRStateFromDocumentWith as readInjectedSSRStateWith,
  type ISSRReadOptions as IInjectedSSRReadOptions,
  type ISSRState
} from '@migaia/store/ssr'
import type { ISerializeRegistry } from '@migaia/store/serialize'

/** Reads the default serialized SSR payload from a browser document. */
export function readSSRStateFromDocument(
  elementId = '__STORE_STATE__',
  documentValue: Document | undefined = globalThis.document
): ISSRState | undefined {
  return readInjectedSSRState(elementId, documentValue)
}

export type ISSRReadOptions = {
  readonly codecs: ISerializeRegistry
  readonly elementId?: string
  readonly document?: Document
  readonly signal?: AbortSignal
}

/** Reads and decodes a codec-tagged SSR payload from a browser document. */
export async function readSSRStateFromDocumentWith(
  options: ISSRReadOptions
): Promise<ISSRState | undefined> {
  return readInjectedSSRStateWith({
    ...options,
    document: options.document ?? globalThis.document
  } as IInjectedSSRReadOptions)
}
