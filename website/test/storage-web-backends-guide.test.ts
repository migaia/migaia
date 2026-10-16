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
        'install',
        'memory',
        'backend-map',
        'web-options',
        'string-methods',
        'namespace'
      ])
      expect(code).toContain('@migaia/storage-web/memory')
      expect(JSON.stringify(sections)).toContain('@migaia/storage-web/local-storage')
      expect(JSON.stringify(sections)).toContain('@migaia/storage-web/session-storage')
      expect(JSON.stringify(sections)).toContain('@migaia/storage-web/cookies')
      expect(JSON.stringify(sections)).toContain('@migaia/storage-web/indexed-db')
      expect(JSON.stringify(guide?.next)).toContain('host-and-plugins')
      expect(JSON.stringify(sections)).toContain('subscribeChanges')
      expect(code).not.toContain('cache.capabilities.changeFeed')
      expect(code).toContain("await settings.set('theme', 'dark')")
      expect(code).toContain("settings.sync.get('theme')")
      expect(code).not.toContain('settings.capabilities.syncRead')
      expect(JSON.stringify(sections)).toContain('sessionStorageHost')
      expect(JSON.stringify(sections)).toContain('sync.set')
      expect(code).not.toContain('checkout.capabilities.syncRead')
      expect(JSON.stringify(sections)).toContain('cookiesHost')
      expect(JSON.stringify(sections)).toContain('conflictPolicy')
      expect(JSON.stringify(sections)).toContain('syncRead')
      expect(JSON.stringify(sections)).toContain('secondaryIndexes')
      expect(JSON.stringify(sections)).toContain('changeFeed')
      expect(JSON.stringify(sections)).toContain('opaqueEntries')
      expect(JSON.stringify(sections)).toContain('maxValueBytes')
      expect(code).toContain('await settings.dispose()')
      expect(JSON.stringify(sections)).toMatch(
        locale === 'zh' ? /没有同步通道/ : /without a synchronous channel/
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
      expect(JSON.stringify(sections)).toContain('setBytes')
      expect(code).toContain('db.iterateRecords(range, {')
      expect(code).toContain('pageSize: 64')
      expect(code).toContain('await db.transaction')
      expect(JSON.stringify(sections)).toContain('TRANSACTION_CONFLICT')
      expect(code).not.toContain('tx.commit()')
      expect(JSON.stringify(sections)).toMatch(
        locale === 'zh' ? /草稿/ : /draft rather than immediately persisting/
      )
      expect(JSON.stringify(sections)).toMatch(
        locale === 'zh' ? /原子提交/ : /commits its draft atomically/
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
      'definition-options',
      'repository',
      'list-options',
      'indexes',
      'schema',
      'codecs',
      'migrations'
    ])
    expect(code).toContain('jsonCodec.encode')
    expect(JSON.stringify(sections)).toContain('jsonCodec')
    expect(JSON.stringify(sections)).toContain('structuredCodec')
    expect(JSON.stringify(sections)).toMatch(locale === 'zh' ? /不制作副本/ : /without copying it/)
    expect(code).toContain('selectCodec(binaryCodec, store.capabilities)')
    expect(JSON.stringify(sections)).toContain('base64')
    expect(code).toContain("await store.setBytes('attachment'")
    expect(JSON.stringify(sections)).toContain('DESERIALIZE_FAILED')
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
      expect(JSON.stringify(sections)).toContain('memoryReactive')
      expect(code).toContain('localStorageReactive')
      expect(code).toContain('sessionStorageReactive')
      expect(JSON.stringify(sections)).toContain('cookiesReactive')
      expect(code).toContain('indexedDbReactive')
      expect(code).toContain('host.liveQuery({')
      expect(code).toContain('await theme.ready')
      expect(code).toContain('await theme.dispose()')
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
        'install',
        'options',
        'plugins',
        'dynamic',
        'custom',
        'helpers'
      ])
      expect(code).toContain("import { createStorageHost } from '@migaia/storage-web/host'")
      expect(code).toContain('memoryBackendPlugin')
      expect(JSON.stringify(sections)).toContain('indexedDbBackendPlugin')
      expect(code).toContain("host.backend('cache')")
      expect(code).toContain('try {')
      expect(code).toContain('finally {')
      expect(JSON.stringify(sections.find((section) => section.id === 'install'))).toMatch(
        /try \{[\s\S]*host\.backend\('drafts'\)[\s\S]*finally \{\\n  await host\.dispose\(\)/
      )
      expect(JSON.stringify(sections.find((section) => section.id === 'dynamic'))).toContain(
        'await host.dispose()'
      )
      expect(JSON.stringify(sections.find((section) => section.id === 'custom'))).toContain(
        'await host.dispose()'
      )

      const cancellation = sections.find((section) => section.id === 'options')
      const cancellationText = JSON.stringify(cancellation)
      expect(cancellationText).toContain('STORAGE_HOST_BUSY')
      expect(JSON.stringify(sections.find((section) => section.id === 'dynamic'))).toMatch(
        locale === 'zh' ? /不删除浏览器持久数据/ : /does not delete browser-persistent data/
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
    expect(code).toContain("path: '/'")
    expect(code).toContain("accountCookies('/account')")
    expect(code).toContain('secure: true')
    expect(code).toContain("namespace: 'site-preferences'")
    expect(code).toContain("namespace: 'account-preferences'")

    const pathText = JSON.stringify(
      sections.filter((section) => ['path-matching', 'path-removal'].includes(section.id))
    )
    expect(pathText).toContain('/account/settings')
    expect(pathText).toContain('/accounting')
    expect(pathText).toMatch(locale === 'zh' ? /不可见/ : /hidden/)
    expect(pathText).toMatch(locale === 'zh' ? /原值仍然存在/ : /cookie intact/)
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
      expect(JSON.stringify(sections)).toContain('ABORTED')
      expect(code).toContain('timeoutMs: 1')
      expect(JSON.stringify(sections)).toContain('QUOTA_EXCEEDED')
      expect(JSON.stringify(sections)).toContain('BACKEND_UNAVAILABLE')
      expect(code).toContain('error.cause')
      expect(code).toContain('await firstStore.dispose()')
      expect(code).toContain("const nextStore = indexedDbHost({ dbName: 'docs-preferences' })")

      const text = JSON.stringify(sections)
      expect(text).toContain('STORE_DISPOSED')
      expect(text).toContain('AggregateError')
      expect(text).toMatch(locale === 'zh' ? /不删除持久数据/ : /does not delete persistent data/)
    }
  )
})
