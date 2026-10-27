// Retired subpaths have no export entry; importing one is a type error, not a silent alias.
// @ts-expect-error -- `./authoring/*` was collapsed into `./sdk`
import type * as authoringQuery from '@migaia/storage-host/authoring/query'
// @ts-expect-error -- `./journal` moved to `./plugins/journal`
import type * as journal from '@migaia/storage-host/journal'
// @ts-expect-error -- `./vector/mmr` was collapsed into `./sdk`
import type * as mmr from '@migaia/storage-host/vector/mmr'

/** Keeps the expected-error imports referenced so the checker evaluates them. */
export type IRetiredSubpaths = [typeof authoringQuery, typeof journal, typeof mmr]
