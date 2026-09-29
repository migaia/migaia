import type { IProcessRecord, IProcessRegistry } from '../../../src/process/index.js'

/** In-memory durable records with a programmable add or remove failure. */
export function memoryRegistry() {
  const records = new Map<string, IProcessRecord>()
  let addFailure: unknown
  let removeFailure: unknown
  const port: IProcessRegistry = {
    async add(record) {
      if (addFailure) throw addFailure
      if (records.has(record.id)) throw new Error('duplicate record')
      records.set(record.id, record)
    },
    async remove(id) {
      if (removeFailure) throw removeFailure
      records.delete(id)
    },
    async list(namespace) {
      return [...records.values()].filter((record) => record.namespace === namespace)
    }
  }
  return {
    port,
    records,
    failAdd(error: unknown) {
      addFailure = error
    },
    failRemove(error: unknown) {
      removeFailure = error
    }
  }
}
