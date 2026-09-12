import { expectTypeOf } from 'vitest'
import {
  localStorageHost,
  sessionStorageHost,
  cookiesHost,
  indexedDbHost,
  memoryStorageHost
} from '../../src/backends'
import type { ISyncKeyValueStore, ISyncCookieStore } from '../../src/types'

// 同步后端的 sync 是非 optional（编译期就知道有）。
expectTypeOf(localStorageHost().sync).toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf(sessionStorageHost().sync).toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf(memoryStorageHost().sync).toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf(cookiesHost().sync).toEqualTypeOf<ISyncCookieStore>()

// IndexedDB 无同步 API：sync 类型上仍是 optional（未做反向收紧），
// 但运行时恒为 undefined，由 backends/indexed-db.test.ts 的运行时断言钉住。
expectTypeOf(indexedDbHost().sync).toEqualTypeOf<ISyncKeyValueStore | undefined>()
