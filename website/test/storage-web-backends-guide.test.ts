import { describe, expect, it } from 'vitest'

import { findGuideJourney } from '../app/guide-journeys.js'

describe('Storage Web backend guide', () => {
  it.each(['zh', 'en'] as const)(
    'covers every public data backend and Host composition in %s',
    (locale) => {
      const guide = findGuideJourney('storage-web', 'getting-started', locale)
      const sections = guide?.document.sections ?? []
      const code = sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')

      expect(sections.map((section) => section.id)).toEqual([
        'backend-map',
        'feature-map',
        'memory',
        'direct',
        'local-storage-sync',
        'session-storage',
        'session-storage-sync',
        'cookies',
        'cookies-sync',
        'records',
        'host',
        'live-query'
      ])
      expect(code).toContain('@migaia/storage-web/memory')
      expect(code).toContain('@migaia/storage-web/local-storage')
      expect(code).toContain('@migaia/storage-web/session-storage')
      expect(code).toContain('@migaia/storage-web/cookies')
      expect(code).toContain('@migaia/storage-web/indexed-db')
      expect(code).toContain('@migaia/storage-web/host')
      expect(code).toContain('cache.subscribeChanges')
      expect(code).not.toContain('cache.capabilities.changeFeed')
      expect(code).toContain("await settings.set('theme', 'dark')")
      expect(code).toContain("settings.sync.set('density', 'compact')")
      expect(code).not.toContain('settings.capabilities.syncRead')
      expect(code).toContain("await checkout.set('step', 'payment')")
      expect(code).toContain("checkout.sync.set('step', 'payment')")
      expect(code).not.toContain('checkout.capabilities.syncRead')
      expect(code).toContain("await preferences.set('locale',")
      expect(code).toContain("preferences.sync.set('locale',")
      expect(code).toContain("indexedDbReactive({ id: 'users'")
      expect(code).toContain('host.liveQuery({')
      expect(code).toContain("matches: (change) => change.scope === 'users'")
      expect(code).toContain('await users.ready')
      expect(code).toContain('await users.refresh()')
      expect(code).toContain('await users.dispose()')
      expect(sections.find((section) => section.id === 'records')?.heading).toMatch(
        locale === 'zh'
          ? /仅提供异步契约.*不存在同步入口/
          : /async contract only.*no synchronous entry/
      )
    }
  )

  it.each(['zh', 'en'] as const)(
    'covers the complete IndexedDB production path in %s',
    (locale) => {
      const guide = findGuideJourney('storage-web', 'indexeddb-and-transactions', locale)
      const sections = guide?.document.sections ?? []
      const code = sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')

      expect(sections.map((section) => section.id)).toEqual([
        'mental-model',
        'records',
        'options',
        'bytes-and-values',
        'iteration',
        'transaction',
        'upgrade-and-shutdown'
      ])
      expect(code).toContain("import { indexedDbHost } from '@migaia/storage-web/indexed-db'")
      expect(code).toContain('await db.putRecord')
      expect(code).toContain('await db.getRecord')
      expect(code).toContain('await db.deleteRecord')
      expect(code).toContain('await db.setBytes')
      expect(code).toContain('db.iterateRecords(range, {')
      expect(code).toContain('pageSize: 64')
      expect(code).toContain('await db.transaction')
      expect(code).toContain('StorageErrorCode.transactionConflict')
      expect(code).toContain('tx.commit()')
      expect(code).toMatch(
        locale === 'zh' ? /tx\.put 只更新.*内存草稿/ : /tx\.put changes only.*in-memory draft/
      )
      expect(code).toMatch(
        locale === 'zh' ? /Promise resolve 表示.*原子落盘/ : /Resolution means.*atomic persistence/
      )
      expect(code).toContain('await db.dispose()')
    }
  )

  it.each(['zh', 'en'] as const)('documents every built-in codec in %s', (locale) => {
    const guide = findGuideJourney('storage-web', 'entity-schema-and-codecs', locale)
    const sections = guide?.document.sections ?? []
    const code = sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.type === 'code')
      .map((block) => block.code)
      .join('\n')

    expect(sections.map((section) => section.id)).toEqual([
      'entity',
      'codec',
      'json-codec',
      'structured-codec',
      'binary-codec',
      'codec-selection'
    ])
    expect(code).toContain('jsonCodec.encode')
    expect(code).toContain('jsonCodec.decode')
    expect(code).toContain('selectCodec(structuredCodec, db.capabilities)')
    expect(code).toContain('snapshot.self = snapshot')
    expect(code).toContain('selectCodec(binaryCodec, binaryStore.capabilities)')
    expect(code).toContain('selectCodec(binaryCodec, textStore.capabilities')
    expect(code).toContain("await binaryStore.setBytes('greeting'")
    expect(code).toContain("await textStore.set('greeting'")
  })

  it.each(['zh', 'en'] as const)(
    'explains live query behavior for every reactive backend in %s',
    (locale) => {
      const guide = findGuideJourney('storage-web', 'reactive-live-queries', locale)
      const sections = guide?.document.sections ?? []
      const code = sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')

      expect(sections.map((section) => section.id)).toEqual([
        'purpose',
        'state-model',
        'memory',
        'local-storage',
        'session-storage',
        'cookies',
        'indexed-db',
        'consistency',
        'cleanup'
      ])
      expect(code).toContain('memoryReactive')
      expect(code).toContain('localStorageReactive')
      expect(code).toContain('sessionStorageReactive')
      expect(code).toContain('cookiesReactive')
      expect(code).toContain('indexedDbReactive')
      expect(code).toContain('host.liveQuery({')
      expect(code).toContain('await theme.ready')
      expect(code).toContain('await locale.ready')
      expect(code).toContain('await step.ready')
      expect(code).toContain('await user.ready')
      expect(code).toContain('keepPreviousData: true')
      expect(code).toContain('timeoutMs: 5_000')
      expect(code).toContain('await user.dispose()')
      expect(code).toContain('await host.dispose()')
    }
  )

  it.each(['zh', 'en'] as const)(
    'explains Host installation, cancellation, and cleanup for beginners in %s',
    (locale) => {
      const guide = findGuideJourney('storage-web', 'host-and-plugins', locale)
      const sections = guide?.document.sections ?? []
      const code = sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')

      expect(sections.map((section) => section.id)).toEqual([
        'mental-model',
        'install',
        'install-cancellation',
        'dispose'
      ])
      expect(code).toContain("import { createStorageHost } from '@migaia/storage-web/host'")
      expect(code).toContain('memoryBackendPlugin')
      expect(code).toContain('indexedDbBackendPlugin')
      expect(code).toContain("host.backend('cache')")
      expect(code).toContain('try {')
      expect(code).toContain('finally {')
      expect(code.match(/await host\.dispose\(\)/g)?.length).toBeGreaterThanOrEqual(3)

      const cancellation = sections.find((section) => section.id === 'install-cancellation')
      const cancellationText = JSON.stringify(cancellation)
      expect(cancellationText).toContain('STORAGE_HOST_BUSY')
      expect(cancellationText).toMatch(
        locale === 'zh' ? /不会删除|不受影响/ : /does not delete|Unaffected/
      )
    }
  )

  it.each(['zh', 'en'] as const)('explains Cookie path visibility and removal in %s', (locale) => {
    const guide = findGuideJourney('storage-web', 'cookies-and-security', locale)
    const sections = guide?.document.sections ?? []
    const code = sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.type === 'code')
      .map((block) => block.code)
      .join('\n')

    expect(sections.map((section) => section.id)).toEqual([
      'scope',
      'path-matching',
      'different-paths',
      'path-removal',
      'opaque'
    ])
    expect(code).toContain("scope: { path: '/', secure: true")
    expect(code).toContain("scope: { path: '/account', secure: true")
    expect(code).toContain("namespace: 'site-preferences'")
    expect(code).toContain("namespace: 'account-preferences'")

    const pathText = JSON.stringify(
      sections.filter((section) => ['path-matching', 'path-removal'].includes(section.id))
    )
    expect(pathText).toContain('/account/settings')
    expect(pathText).toContain('/accounting')
    expect(pathText).toMatch(locale === 'zh' ? /不会误匹配|不可见/ : /accounting|Hidden/)
    expect(pathText).toMatch(locale === 'zh' ? /仍然存在|仍存在/ : /remains|leaving/)
  })

  it.each(['zh', 'en'] as const)(
    'teaches cancellation, error recovery, and terminal state in %s',
    (locale) => {
      const guide = findGuideJourney('storage-web', 'cancellation-errors-and-shutdown', locale)
      const sections = guide?.document.sections ?? []
      const code = sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')

      expect(sections.map((section) => section.id)).toEqual([
        'decision-map',
        'user-cancellation',
        'timeout',
        'error-handling',
        'cause-chain',
        'terminal'
      ])
      expect(code).toContain('new AbortController()')
      expect(code).toContain("controller.abort('search panel closed')")
      expect(code).toContain('StorageContractErrorCode.aborted')
      expect(code).toContain('timeoutMs: 2_000')
      expect(code).toContain('StorageErrorCode.quotaExceeded')
      expect(code).toContain('StorageErrorCode.unavailable')
      expect(code).toContain('error.cause')
      expect(code).toContain('await firstStore.dispose()')
      expect(code).toContain('const nextStore = memoryStorageHost()')

      const text = JSON.stringify(sections)
      expect(text).toContain('STORE_DISPOSED')
      expect(text).toContain('AggregateError')
      expect(text).toMatch(locale === 'zh' ? /不删除持久数据/ : /does not delete persistent data/)
    }
  )
})
