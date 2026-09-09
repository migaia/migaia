import type { IDomain, ILocale } from './route-contract.js'

/** Stable localized interface copy shared by every website route. */
export const WebsiteCopy = {
  en: {
    skip: 'Skip to content',
    primaryNavigation: 'Primary navigation',
    docs: 'Docs',
    guides: 'Guides',
    menu: 'Menu',
    search: 'Search',
    theme: 'Toggle theme',
    close: 'Close',
    mobileNavigation: 'Mobile navigation',
    navigate: 'Navigate',
    searchLabel: 'Find a library, API, guide, or architecture topic',
    searchPlaceholder: 'Search the library',
    searchEmpty: 'Type to search the documentation.',
    searchUnknown: 'No matching result yet. Try a library or API name.',
    capabilityMap: 'Capability map',
    shortestPath: 'Choose the shortest useful path.',
    foundation: 'Foundation',
    foundationText: 'Stable primitives and utility APIs.',
    runtime: 'Runtime',
    runtimeText: 'Task-focused paths with observable checks.',
    stateStorage: 'State & storage',
    stateStorageText: 'Compose state, persistence, and boundaries.',
    integration: 'Integration',
    integrationText: 'Understand transport and platform edges.',
    startFive: 'Start in 5 minutes',
    smallResult: 'Make one small result.',
    quickstartBody:
      'Use the lowest-dependency library, read its module entry, and verify the returned value before adding integrations.',
    readQuickstart: 'Read the quickstart →',
    commonCombinations: 'Common combinations',
    combinationTitle: 'Connect libraries by production responsibility.',
    reactiveResource: 'Reactive + Resource',
    reactiveResourceText:
      'Track changing inputs, cancel stale requests, and expose loading, success, and failure states.',
    capabilityPluginHost: 'Capability + Plugin Host',
    capabilityPluginHostText:
      'Enable optional features by policy, then install, consume, replace, and release their implementations.',
    webRpcSerialize: 'WebRPC + Serialize',
    webRpcSerializeText:
      'Define typed remote calls, choose a codec, and connect the contract to a browser or worker transport.',
    libraryIndex: 'Library index',
    responsibility: 'Responsibility and boundary',
    responsibilityBody:
      'This library owns the public capabilities listed below. Read a module to see its inputs, outputs, usage constraints, and error or lifecycle notes.',
    moduleMap: 'Module map',
    libraryModules: 'Library modules',
    onPage: 'On this page',
    mobileSections: 'Mobile API sections',
    publicApiSymbols: 'Public API symbols',
    publicApiIntro:
      'Each canonical exported symbol below owns its source-backed introduction, setup, scenario, implementation, core, and advanced contract.',
    reexports: 'Re-exported symbols',
    reexportsBody:
      'These exports are aliases of canonical source declarations and link to their single owning API section.',
    publicSymbols: 'Public symbols',
    apiModules: 'API modules',
    sourceBacked: 'source-backed',
    exports: 'exports',
    applyGuide: 'Apply it in a guide →',
    understandBoundary: 'Understand the boundary →',
    libraryEntry: 'Library entry',
    browseLibraries: 'Browse libraries',
    taskGuides: 'Task guides',
    architecture: 'Architecture',
    continueReading: 'Continue reading',
    nothingMatched: 'Nothing matched that module.',
    nothingMatchedBody: 'Choose a module from the library tree or return to the library entry.',
    returnTo: 'Return to',
    notFound: 'Not found',
    missingEntry: 'This entry does not exist.',
    missingEntryBody: 'Choose a current library from the index to continue.',
    browse: 'Browse',
    domainTitle: {
      docs: 'Find the API you need.',
      guides: 'Reach a practical result.',
      architecture: 'Build a system mental model.'
    },
    domainDescription: {
      docs: 'Browse source-backed library entries, module boundaries, and stable API anchors.',
      guides: 'Choose an outcome, then follow the verification steps and linked API fragments.',
      architecture:
        'Trace ownership, boundaries, and data flow before choosing an integration point.'
    }
  },
  zh: {
    skip: '跳到正文',
    primaryNavigation: '主导航',
    docs: '文档',
    guides: '指南',
    menu: '菜单',
    search: '搜索',
    theme: '切换主题',
    close: '关闭',
    mobileNavigation: '移动端导航',
    navigate: '导航',
    searchLabel: '查找类库、API、指南或架构主题',
    searchPlaceholder: '搜索文档',
    searchEmpty: '输入内容以搜索文档。',
    searchUnknown: '没有匹配结果，请尝试类库名或 API 名。',
    capabilityMap: '能力地图',
    shortestPath: '选择最短且有效的路径。',
    foundation: '基础能力',
    foundationText: '稳定的基础能力与工具 API。',
    runtime: '运行时',
    runtimeText: '以任务为中心，并提供可观察的验证步骤。',
    stateStorage: '状态与存储',
    stateStorageText: '组合状态、持久化与边界。',
    integration: '集成',
    integrationText: '理解传输层与平台边界。',
    startFive: '五分钟上手',
    smallResult: '先完成一个小而明确的结果。',
    quickstartBody: '从依赖最少的类库开始，阅读模块入口并验证返回值，再逐步加入集成能力。',
    readQuickstart: '阅读快速上手 →',
    commonCombinations: '常用组合',
    combinationTitle: '按生产职责组合类库。',
    reactiveResource: 'Reactive + Resource',
    reactiveResourceText: '跟踪变化的输入，取消过期请求，并统一暴露加载、成功与失败状态。',
    capabilityPluginHost: 'Capability + Plugin Host',
    capabilityPluginHostText: '按策略启用可选能力，再安装、消费、替换并释放对应实现。',
    webRpcSerialize: 'WebRPC + Serialize',
    webRpcSerializeText: '定义类型安全的远程调用，选择编解码器，并接入浏览器或 Worker 传输。',
    libraryIndex: '类库索引',
    responsibility: '职责与边界',
    responsibilityBody:
      '该类库拥有下列公开能力。进入模块可查看输入、输出、使用约束，以及错误或生命周期说明。',
    moduleMap: '模块地图',
    libraryModules: '类库模块',
    onPage: '本页内容',
    mobileSections: '移动端 API 章节',
    publicApiSymbols: '公开 API 符号',
    publicApiIntro: '每个规范导出符号都拥有由源码支撑的介绍、准备、场景、实现、核心与高阶契约。',
    reexports: '重新导出的符号',
    reexportsBody: '这些导出是规范源码声明的别名，并指向唯一归属的 API 章节。',
    publicSymbols: '公开符号',
    apiModules: 'API 模块',
    sourceBacked: '源码支撑',
    exports: '个导出',
    applyGuide: '在指南中应用 →',
    understandBoundary: '理解边界 →',
    libraryEntry: '类库入口',
    browseLibraries: '浏览类库',
    taskGuides: '任务指南',
    architecture: '架构',
    continueReading: '继续阅读',
    nothingMatched: '没有匹配的模块。',
    nothingMatchedBody: '请从类库树中选择模块，或返回类库入口。',
    returnTo: '返回',
    notFound: '未找到',
    missingEntry: '该入口不存在。',
    missingEntryBody: '请从索引中选择当前可用的类库继续。',
    browse: '浏览',
    domainTitle: {
      docs: '找到你需要的 API。',
      guides: '完成一个可验证的实际结果。',
      architecture: '建立系统架构心智模型。'
    },
    domainDescription: {
      docs: '浏览由源码支撑的类库入口、模块边界与稳定 API 锚点。',
      guides: '先选择目标，再沿着验证步骤和关联 API 完成任务。',
      architecture: '先追踪归属、边界和数据流，再选择集成点。'
    }
  }
} as const

/** Returns the localized website copy for one canonical locale. */
export function copyFor(locale: ILocale) {
  return WebsiteCopy[locale]
}

/** Returns a localized content-domain title. */
export function domainTitle(locale: ILocale, domain: IDomain): string {
  return WebsiteCopy[locale].domainTitle[domain]
}

/** Returns a localized content-domain introduction. */
export function domainDescription(locale: ILocale, domain: IDomain): string {
  return WebsiteCopy[locale].domainDescription[domain]
}
