/** Stable texts of `partom extract --usage`: report reasons and fixed text of generated files. */

/**
 * Reasons of uncertain usage items. Contract text: tooling and tests match them to tell the kinds
 * of manual follow-up apart.
 */
export const UsageReason = {
  /** A `className` on an extracted component was dropped; styles stay in code. */
  classDropped: 'class-dropped',
  /** An element could not be converted and became a black-box part. */
  blackbox: 'blackbox',
  /** An event handler became an effect draft that throws until reviewed. */
  effectDraft: 'effect-draft',
  /** A DataTable's `columns` is not a module-level array literal; no columns or cells were made. */
  columnsUnresolved: 'columns-unresolved',
  /** A DataTable's `data` must be bound to a resource by hand. */
  bindResource: 'bind-resource',
  /** A DataTable column has a `cell` renderer; it shows the raw field instead. */
  cellDropped: 'cell-dropped',
  /** A DataTable's row key was guessed as `id`. */
  rowKeyGuessed: 'row-key-guessed',
  /** A part the conversion needs is missing from the component report. */
  partMissing: 'part-missing',
  /** The page references component-local bindings that cannot leave it; nothing was converted. */
  pageUnconvertible: 'page-unconvertible',
  /**
   * A page has the file name of an earlier page of the run; its files would collide, so it was
   * skipped.
   */
  duplicatePage: 'duplicate-page',
  /** A file has no exported component with a single JSX return. */
  noComponent: 'no-component'
} as const

/** One usage reason. */
export type UsageReason = (typeof UsageReason)[keyof typeof UsageReason]

/** Fixed text written into generated files. */
export const UsageText = {
  /** Message thrown by effect drafts until a person replaces their body. */
  reviewRequired: 'partom: this effect was generated from page code and needs review'
} as const
