import type { IDescriptor } from '../../src/index.ts'

/** Table part with a resource group and three declared status slots. */
export const tablePart: IDescriptor = {
  kind: 'part',
  id: 'table@1',
  slots: { loading: {}, empty: {}, error: {} },
  behavior: {
    resource: { prop: 'source', slots: { loading: 'loading', empty: 'empty', error: 'error' } }
  }
}

/** Field part whose change event is a declared component event. */
export const fieldPart: IDescriptor = {
  kind: 'part',
  id: 'field@1',
  events: { valueChange: { kind: 'component' } },
  behavior: { field: { value: 'value', change: 'valueChange' } }
}
