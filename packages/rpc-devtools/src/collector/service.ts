import type { IRpcDevtools } from '../collector-types.js'
import type { IRpcDevtoolsQuery } from '../contract/service.js'
import type { IRpcDevtoolsRecord } from '../contract/record.js'
import type { IRuntimePeerProvide } from '@migaia/rpc-core/remote'

/** Boundary callbacks reuse the collector's one lifecycle owner and independent record ring. */
export type ICollectorServiceOwner = Pick<
  IRpcDevtools,
  'describe' | 'stats' | 'record' | 'clear' | 'pause' | 'resume' | 'exportRecord'
> & {
  query(input?: IRpcDevtoolsQuery, content?: boolean): ReturnType<IRpcDevtools['query']>
  watch(
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>,
    content?: boolean
  ): ReturnType<IRpcDevtools['watch']>
  stopRecord(content: boolean): IRpcDevtoolsRecord
}

/** A real service boundary enforces exposeContent on query, watch and exported recordings. */
export function createCollectorService(
  owner: ICollectorServiceOwner,
  exposeContent: boolean
): IRuntimePeerProvide {
  return {
    describe: owner.describe,
    query: (input?: IRpcDevtoolsQuery) => owner.query(input, exposeContent),
    watch: (input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>) =>
      owner.watch(input, exposeContent),
    stats: owner.stats,
    record: {
      start: (input?: Readonly<{ maxEvents?: number }>) => {
        owner.record(input)
      },
      stop: () => owner.exportRecord(owner.stopRecord(exposeContent))
    },
    clear: owner.clear,
    pause: owner.pause,
    resume: owner.resume
  }
}
