import { createConcurrencyLimiter, type IConcurrencyLimiter } from '@migaia/utils/promise'
import { createTrayError } from '../../errors.js'
import { TrayErrorCode } from '../../error-code.js'
import { TrayInstanceState, type TrayManagementMode } from '../constants.js'
import type { IAnyTrayHost, ITrayInstance } from '../typing.js'
/** Metadata belongs to one id admission; RPC remains the connection and generation owner. */
export type ITrayRecord = {
  definition: IAnyTrayHost
  id: string
  admission: object
  config: unknown
  state: TrayInstanceState
  generation: number
  instanceId?: string
  removed: boolean
  queue: IConcurrencyLimiter
  management?: TrayManagementMode
  install?: Promise<void>
  inits: Map<number, Promise<void>>
  receipts: Set<string>
}
/** Keep admitted metadata and relay receipts together so ended admissions cannot be revived. */
export function createRegistry(report: (error: unknown) => void) {
  /** This table stores business metadata only, never RPC native state. */
  const records = new Map<string, ITrayRecord>()
  /** Sender identity is the single projection from the accepted outlet detail. */
  const instanceIds = new Map<string, { record: ITrayRecord; generation: number }>()
  /** Opaque child receipts point to the exact admission that created them. */
  const receipts = new Map<string, ITrayRecord>()
  /** Frozen results capture each management entry's own committed outcome. */
  const snapshot = (record: ITrayRecord): ITrayInstance =>
    Object.freeze({
      id: record.id,
      host: record.definition.name,
      runtime: record.definition.runtime,
      state: record.state,
      generation: record.generation,
      config: record.config
    })
  /** Validate a captured admission before every new call or lifecycle result. */
  const assertCurrent = (record: ITrayRecord): void => {
    if (record.removed || records.get(record.id) !== record)
      throw createTrayError(TrayErrorCode.instanceUnknown)
  }
  /** Lookup is by the admitted record, not an outlet's current same-name connection. */
  const get = (id: string): ITrayRecord => {
    const record = records.get(id)
    if (!record) throw createTrayError(TrayErrorCode.instanceUnknown)
    assertCurrent(record)
    return record
  }
  /** Remove all receipt and sender projections before resources are released. */
  const revoke = (record: ITrayRecord): void => {
    record.removed = true
    records.delete(record.id)
    if (record.instanceId) instanceIds.delete(record.instanceId)
    for (const receipt of record.receipts) receipts.delete(receipt)
    record.receipts.clear()
  }
  return {
    records,
    instanceIds,
    receipts,
    snapshot,
    assertCurrent,
    get,
    revoke,
    /** A limiter supplies the existing FIFO operation owner rather than a second scheduler. */
    admit(definition: IAnyTrayHost, id: string, config: unknown): ITrayRecord {
      if (records.has(id)) throw createTrayError(TrayErrorCode.instanceDuplicate)
      const record: ITrayRecord = {
        definition,
        id,
        admission: {},
        config,
        state: TrayInstanceState.starting,
        generation: 0,
        removed: false,
        queue: createConcurrencyLimiter({ concurrency: 1, report }),
        inits: new Map(),
        receipts: new Set()
      }
      records.set(id, record)
      return record
    },
    /** Accepted detail replaces only the id projection; the outlet keeps native generations. */
    identify(record: ITrayRecord, generation: number, instanceId: string): void {
      assertCurrent(record)
      if (record.instanceId) instanceIds.delete(record.instanceId)
      record.generation = generation
      record.instanceId = instanceId
      instanceIds.set(instanceId, { record, generation })
    },
    /** A receipt is meaningful only to this registry admission and never grants a native handle. */
    bind(host: string, id: string): string {
      const record = get(id)
      if (record.definition.name !== host) throw createTrayError(TrayErrorCode.hostMismatch)
      const receipt = globalThis.crypto.randomUUID()
      receipts.set(receipt, record)
      record.receipts.add(receipt)
      return receipt
    },
    /** Child remotes cannot bind to a same-id replacement with an old admission receipt. */
    receipt(host: string, id: string, token: string): ITrayRecord {
      const record = get(id)
      if (record.definition.name !== host) throw createTrayError(TrayErrorCode.hostMismatch)
      if (receipts.get(token) !== record) throw createTrayError(TrayErrorCode.instanceUnknown)
      return record
    }
  }
}
export type ITrayRegistry = ReturnType<typeof createRegistry>
