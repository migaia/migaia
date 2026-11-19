/**
 * The editor throws no errors across a package boundary: the server prints usage problems and
 * exits, and page failures (network, 401, rejected changesets) are shown in the page's status bar.
 * The table stays empty until a boundary error exists.
 */
export const PartEditorErrorCode = {} as const

/** Value union of every `part.editor` error code (none yet). */
export type IPartEditorErrorCode = (typeof PartEditorErrorCode)[keyof typeof PartEditorErrorCode]
