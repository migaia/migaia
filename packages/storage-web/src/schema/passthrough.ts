import type { ISchemaAdapter } from './types';

/** 零校验直接透传。默认值——不传 schema 就是它，零依赖零开销。 */
export const passthrough = <T = unknown>(): ISchemaAdapter<T, T> => ({
  name: 'passthrough',
  validate: async (value) => value as T
});
