import { splitDescriptorId } from '../descriptor-id.ts'
import type { ICatalogView, IDescriptor } from '../types.ts'

/**
 * Read-only catalog view over a fixed descriptor list (a snapshot's descriptors, draft module
 * definitions or an editor's loaded catalog); built once per check, each lookup O(1).
 */
export function descriptorView(descriptors: readonly IDescriptor[]): ICatalogView {
  /** Descriptors by id. */
  const byId = new Map<string, IDescriptor>()
  /** Majors by name. */
  const majors = new Map<string, number[]>()
  /** Enhancer writes by targeted part name. */
  const writes = new Map<string, string[]>()
  for (const descriptor of descriptors) {
    byId.set(descriptor.id, descriptor)
    /** Name and major of the id. */
    const { name, major } = splitDescriptorId(descriptor.id)
    /** Majors of the name so far. */
    const known = majors.get(name) ?? []
    known.push(major)
    majors.set(name, known)
    if (descriptor.kind === 'enhancer')
      for (const target of descriptor.targets ?? []) {
        /** Writes of the target so far. */
        const list = writes.get(target) ?? []
        list.push(...(descriptor.writes ?? []))
        writes.set(target, list)
      }
  }
  return {
    get: (id) => byId.get(id),
    majors: (name) => majors.get(name) ?? [],
    writesFor: (tag) => writes.get(splitDescriptorId(tag).name) ?? [],
    all: () => byId.values()
  }
}
