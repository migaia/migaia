import {
  RpcDevtoolsRecordFormat,
  type IRpcDevtoolsRecord,
  type IRpcDevtoolsRecordEvent
} from '../contract/record.js'
import { EventRing } from './ring.js'

/** Stop converts numeric columns at the record boundary, preserving native errors/content (SC9b). */
export function finishRecord(ring: EventRing, exposeContent = true): IRpcDevtoolsRecord {
  /** Record rows are built only for this explicitly requested representation boundary. */
  const events: IRpcDevtoolsRecordEvent[] = []
  for (let i = 0; i < ring.count; i++)
    events.push(ring.event((ring.head + i) % ring.capacity, exposeContent, true))
  ring.clear()
  return { header: RpcDevtoolsRecordFormat, events }
}
