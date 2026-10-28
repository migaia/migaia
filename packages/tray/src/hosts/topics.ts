import type { IRpcPortableValue } from '@migaia/rpc-host/contract'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'

/** Authenticated publisher identity is separate from arbitrary business payloads. */
export type ITrayTopicMeta = Readonly<{
  /** Parent-authenticated publisher, supplied separately from application-controlled payload data. */
  from: Readonly<{ id: string; host: string; generation: number }> | Readonly<{ parent: true }>
}>
/** Local user callbacks may return a Promise; EventSubscriber observes its rejection. */
export type ITrayTopicListener = (
  payload: IRpcPortableValue | undefined,
  meta: ITrayTopicMeta
) => void
/** Only portable business data and parent-authenticated metadata cross the delivery notify. */
export type ITrayTopicDelivery = Readonly<{
  topic: string
  payload?: IRpcPortableValue
  meta: ITrayTopicMeta
}>

/** Reject empty or non-string business topics before the local hub or parent relay is touched. */
export function assertTopic(topic: unknown): asserts topic is string {
  if (typeof topic !== 'string' || topic.length === 0)
    throw createTrayError(TrayErrorCode.topicInvalid)
}
