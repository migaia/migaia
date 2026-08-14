import { expectTypeOf } from 'vitest';
import {
  localStorage,
  sessionStorage,
  cookies,
  indexedDb,
  memoryStorage
} from '../../src/backends';
import type { ISyncKeyValueStore, ISyncCookieStore } from '../../src/types';

// 同步后端的 sync 是非 optional（编译期就知道有）。
expectTypeOf(localStorage().sync).toEqualTypeOf<ISyncKeyValueStore>();
expectTypeOf(sessionStorage().sync).toEqualTypeOf<ISyncKeyValueStore>();
expectTypeOf(memoryStorage().sync).toEqualTypeOf<ISyncKeyValueStore>();
expectTypeOf(cookies().sync).toEqualTypeOf<ISyncCookieStore>();

// IndexedDB 无同步 API：sync 类型上仍是 optional（未做反向收紧），
// 但运行时恒为 undefined，由 backends/indexed-db.test.ts 的运行时断言钉住。
expectTypeOf(indexedDb().sync).toEqualTypeOf<ISyncKeyValueStore | undefined>();
