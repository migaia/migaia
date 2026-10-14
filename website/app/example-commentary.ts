import type { ILocale } from './content.js'

type ICommentedExample = {
  readonly code: string
  readonly notes: readonly string[]
}

export type IExampleCommentaryContext = {
  /** Library that owns the maintained example and its diagnostic prose. */
  readonly library?: string
  /** Public API whose maintained guide owns this example. */
  readonly apiName: string
  /** Distinguishes executable walkthroughs from compile-time declaration guidance. */
  readonly kind?: 'example' | 'signature'
  /** Public parameter names displayed beside a signature. */
  readonly parameterNames?: readonly string[]
  /** Concrete behavior promised by the maintained guide. */
  readonly purpose: string
  /** Representative production situation for this exact API. */
  readonly scenario?: string
}

/** Preserves authored code exactly; example context never adds comments or walkthrough prose. */
export function commentExample(
  code: string,
  _language: string,
  _locale: ILocale,
  _context?: IExampleCommentaryContext
): ICommentedExample {
  return { code, notes: [] }
}
