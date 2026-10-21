/**
 * Reference for `@migaia/serialize`; contract: `app/reference/contract.ts`. Checked against
 * packages/serialize/src, README and USEGUIDE on 2026-10-18. Standalone parser and conversion
 * failures carry semantic codes and retain their original cause where wrapping is required. Codec
 * factories require positive safe integer versions; the JSON plugin has no version field and
 * follows native JSON rather than codec portable rules. Source defaults differ from contextual
 * README prose: registry operation context is `anonymous`; `registry` is used for missing-codec
 * diagnostics. `collectStream` currently requires an encoder whenever it assembles multiple chunks
 * containing bytes, even if all chunks already carry bytes.
 */
import type { ILibraryReference, IMemberDoc, IOptionCaseDoc, IText, ITypeDoc } from './contract.js'
import { serializeCases } from './serialize-cases.ts'

/** Creates localized prose without locale fallback. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete registry lifecycle, shared by examples of its installed JSON capability. */
const registryExample = `import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize'

const registry = createSerializeRegistry([jsonPlugin()])
const chunk = await registry.encode({ count: 2 })
console.log(registry.primaryType, registry.types, registry.has('json'))
console.log(await registry.decode(chunk))
registry.close()
await registry.dispose()`

/** Standalone parser usage supplies its explicit operation context. */
const parserExample = `import { jsonParser } from '@migaia/serialize/plugins'
import { createAbortController } from '@migaia/lifecycle/abort'

const parser = jsonParser()
const context = { signal: createAbortController().signal, context: 'settings' }
const chunk = await parser.encode({ enabled: true }, context)
console.log(await parser.decode(chunk, context))
await parser.dispose?.()`

/** Independent format codecs expose synchronous round trips. */
const codecExample = `import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const codec = defineJsonCodec({ version: 1 })
const encoded = codec.encode({ count: 2 })
console.log(codec.id, codec.version, codec.encodedType, codec.decode(encoded))`

/** Minimal custom walker uses explicit synchronous policies, with no format runtime. */
const walkerExample = `import { createPortableWalker } from '@migaia/serialize/codec'
import { createSerializeTypeError, SerializeErrorCode } from '@migaia/serialize/core'

const walk = createPortableWalker({
  maxDepth: 8,
  scalar: (value) => ({ value }),
  binary: (value, context) => context.isUint8Array(value) ? value : undefined,
  nativeByteLength: (value) => value.byteLength,
  record: (value) => Array.isArray(value)
    ? undefined
    : { entries: Object.entries(value), output: {} },
  array: (value, visit) => value.map(visit),
  key: (key, context) => { if (key === 'password') context.reject('private-field') },
  write: (output, key, child) => {
    Object.defineProperty(output, key, { value: child, enumerable: true })
  },
  finish: (value) => Object.freeze(value),
  violation: (reason, cause) => {
    throw createSerializeTypeError(SerializeErrorCode.invalidOption, reason, { cause })
  }
})
console.log(walk({ count: 2, bytes: new Uint8Array([1, 2]) }))
console.log(walk.value([1, 2]))`

/** Explicit scheduling keeps core stream examples independent from host timer assumptions. */
const streamExample = `import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize'
import { encodeStream, decodeStream } from '@migaia/serialize/core'
import { systemScheduler } from '@migaia/utils/scheduler'

const registry = createSerializeRegistry([jsonPlugin()])
const chunks = encodeStream(registry, [1, 2, 3], { scheduler: systemScheduler })
for await (const value of decodeStream(registry, chunks)) console.log(value)
await registry.dispose()`

/** Reader scenarios use application-owned parsers, streams and clocks. */
const serializeOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  IJsonCodecOptions: [
    {
      title: t('Write an agreed archive revision', '写入约定版本的存档'),
      problem: t(
        'The settings archive has an application-selected format revision. The codec requires that revision explicitly; it does not negotiate versions or migrate stored values.',
        '设置存档使用应用约定的格式版本。编解码器要求明确传入该版本，不会协商版本或迁移保存值。'
      ),
      example: `import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const codec = defineJsonCodec({ version: 2 })
await saveSettingsArchive(codec.encode(editorSettings))`,
      result: t(
        'The application saves settings with its version-two codec.',
        '应用使用第二版编解码器保存设置。'
      ),
      covers: ['version']
    },
    {
      title: t('Keep the previous archive reader available', '保留上一版存档读取器'),
      problem: t(
        'A deployment still reads archives written by its predecessor. Construct separate codecs for the two revisions and let the application choose by its stored metadata; changing configuration does not relabel an existing codec.',
        '部署后仍需读取上一版本保存的存档。为两个版本分别创建编解码器，由应用按保存元数据选择；修改配置不会给已有实例重新标记版本。'
      ),
      example: `import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const previous = defineJsonCodec({ version: 1 })
const current = defineJsonCodec({ version: 2 })
registerArchiveReaders([previous, current])`,
      result: t(
        'The application retains readers for both revisions without mutating the earlier codec.',
        '应用同时保留两个版本的读取器，不修改旧编解码器。'
      ),
      covers: ['version']
    }
  ],
  ICborCodecOptions: [
    {
      title: t('Write an agreed archive revision', '写入约定版本的存档'),
      problem: t(
        'The settings archive has an application-selected format revision. The codec requires that revision explicitly; it does not negotiate versions or migrate stored values.',
        '设置存档使用应用约定的格式版本。编解码器要求明确传入该版本，不会协商版本或迁移保存值。'
      ),
      example: `import { defineCBORCodec } from '@migaia/serialize/codecs/cbor'

const codec = defineCBORCodec({ version: 2 })
await saveSettingsArchive(codec.encode(editorSettings))`,
      result: t(
        'The application saves settings with its version-two codec.',
        '应用使用第二版编解码器保存设置。'
      ),
      covers: ['version']
    },
    {
      title: t('Keep the previous archive reader available', '保留上一版存档读取器'),
      problem: t(
        'A deployment still reads archives written by its predecessor. Construct separate codecs for the two revisions and let the application choose by its stored metadata; changing configuration does not relabel an existing codec.',
        '部署后仍需读取上一版本保存的存档。为两个版本分别创建编解码器，由应用按保存元数据选择；修改配置不会给已有实例重新标记版本。'
      ),
      example: `import { defineCBORCodec } from '@migaia/serialize/codecs/cbor'

const previous = defineCBORCodec({ version: 1 })
const current = defineCBORCodec({ version: 2 })
registerArchiveReaders([previous, current])`,
      result: t(
        'The application retains readers for both revisions without mutating the earlier codec.',
        '应用同时保留两个版本的读取器，不修改旧编解码器。'
      ),
      covers: ['version']
    }
  ],
  IMessagePackCodecOptions: [
    {
      title: t('Write an agreed archive revision', '写入约定版本的存档'),
      problem: t(
        'The settings archive has an application-selected format revision. The codec requires that revision explicitly; it does not negotiate versions or migrate stored values.',
        '设置存档使用应用约定的格式版本。编解码器要求明确传入该版本，不会协商版本或迁移保存值。'
      ),
      example: `import { defineMessagePackCodec } from '@migaia/serialize/codecs/message-pack'

const codec = defineMessagePackCodec({ version: 2 })
await saveSettingsArchive(codec.encode(editorSettings))`,
      result: t(
        'The application saves settings with its version-two codec.',
        '应用使用第二版编解码器保存设置。'
      ),
      covers: ['version']
    },
    {
      title: t('Keep the previous archive reader available', '保留上一版存档读取器'),
      problem: t(
        'A deployment still reads archives written by its predecessor. Construct separate codecs for the two revisions and let the application choose by its stored metadata; changing configuration does not relabel an existing codec.',
        '部署后仍需读取上一版本保存的存档。为两个版本分别创建编解码器，由应用按保存元数据选择；修改配置不会给已有实例重新标记版本。'
      ),
      example: `import { defineMessagePackCodec } from '@migaia/serialize/codecs/message-pack'

const previous = defineMessagePackCodec({ version: 1 })
const current = defineMessagePackCodec({ version: 2 })
registerArchiveReaders([previous, current])`,
      result: t(
        'The application retains readers for both revisions without mutating the earlier codec.',
        '应用同时保留两个版本的读取器，不修改旧编解码器。'
      ),
      covers: ['version']
    }
  ],
  IProtobufCodecOptions: [
    {
      title: t('Encode invoices with the generated binding', '用生成的绑定编码发票'),
      problem: t(
        'The application already has its generated InvoiceSchema descriptor. Supply that executable binding separately from the application schema identity and codec revision.',
        '应用已经拥有生成的 InvoiceSchema 描述符。将可执行绑定与应用模式标识、编解码版本分别传入。'
      ),
      example: `import { defineProtobufCodec } from '@migaia/serialize/codecs/protobuf'

const codec = defineProtobufCodec({
  version: 2,
  schema: { id: 'invoice', version: 1 },
  binding: InvoiceSchema
})
await sendInvoice(codec.encode(invoice))`,
      result: t(
        'The generated binding encodes the invoice; schema version one remains distinct from codec revision two.',
        '生成的绑定负责编码发票，模式第一版与编解码第二版保持独立。'
      ),
      covers: ['version', 'schema', 'binding']
    },
    {
      title: t('Register the saved schema identity', '登记保存格式的模式标识'),
      problem: t(
        'An archive catalog routes stored messages by schema identity. Construction snapshots the supplied schema metadata, so later application configuration changes do not change this registered codec.',
        '存档目录按模式标识路由已保存消息。构造会固定传入的模式元数据，应用后续修改配置不会改变已登记的编解码器。'
      ),
      example: `import { defineProtobufCodec } from '@migaia/serialize/codecs/protobuf'

const codec = defineProtobufCodec({
  version: 1,
  schema: invoiceSchemaIdentity,
  binding: InvoiceSchema
})
registerSchemaReader(codec.schema, codec)`,
      result: t(
        'The catalog keeps the schema identity captured when this reader was created.',
        '目录保留此读取器创建时取得的模式标识。'
      ),
      covers: ['version', 'schema', 'binding']
    }
  ],
  ICollectStreamOptions: [
    {
      title: t('Allow an empty notes download', '允许下载空白备注'),
      problem: t(
        'A notes export may legitimately contain no chunks. Explicit text mode produces an empty text file instead of treating that result as an export failure.',
        '备注导出可能没有任何分块。显式 text 模式将其保存为空文本文件，不把它视为导出失败。'
      ),
      example: `import { collectStream } from '@migaia/serialize/core'

const notes = await collectStream(noteChunks, new TextEncoder(), {
  empty: 'text',
  context: 'optional-notes'
})
offerNotesDownload(notes)`,
      result: t(
        'An empty source produces an empty notes download; failures carry the optional-notes label.',
        '空来源产生空白备注下载，失败则携带 optional-notes 标签。'
      ),
      covers: ['empty', 'context']
    },
    {
      title: t('Cancel a required export with its request', '随请求取消必需导出'),
      problem: t(
        'A required export should not deliver an empty file or keep collecting after its request ends. Reject empty output and forward the request signal.',
        '必需导出不能交付空文件，也不应在请求结束后继续收集。拒绝空结果，并转交请求信号。'
      ),
      example: `import { collectStream } from '@migaia/serialize/core'

try {
  const file = await collectStream(exportChunks, new TextEncoder(), {
    empty: 'reject',
    context: 'invoice-export',
    signal: requestSignal
  })
  offerInvoiceDownload(file)
} catch (error) {
  showExportError(error)
}`,
      result: t(
        'A cancelled or empty required export shows an error instead of offering a file.',
        '取消或空白的必需导出显示错误，不会提供文件。'
      ),
      covers: ['empty', 'context', 'signal']
    }
  ],
  IFrameBudgetOptions: [
    {
      title: t('Render imported rows in adjustable batches', '按可调整批次渲染导入行'),
      problem: t(
        'An import view must share the event loop with other UI work. Set a processing target and item bounds, then use the application clock and yield operation between batches; the target does not interrupt row rendering.',
        '导入视图需要与其他界面工作共用事件循环。设置处理目标与条目边界，并在批次之间使用应用时钟和让出操作；目标时长不会中断行渲染。'
      ),
      example: `import { sliceByFrameBudget } from '@migaia/serialize/core'

for await (const rows of sliceByFrameBudget(importRows, {
  targetMs: 8,
  minItems: 10,
  maxItems: 200,
  initialItems: 20,
  scheduler: importScheduler,
  yieldTo: () => waitForNextPaint()
})) {
  appendImportRows(rows)
}`,
      result: t(
        'The view receives ordered batches and yields between them while the batch size adapts to consumer work.',
        '视图按顺序接收批次，并在批次之间让出执行机会；批次大小按消费开销调整。'
      ),
      covers: ['targetMs', 'minItems', 'maxItems', 'initialItems', 'scheduler', 'yieldTo']
    },
    {
      title: t('Stop rendering after the import view closes', '导入视图关闭后停止渲染'),
      problem: t(
        'The view already owns its batch policy. Adding its lifetime signal stops later slices when it closes, while rows already displayed remain displayed.',
        '视图已经持有分批策略。加入其生命周期信号，可在关闭时停止后续切片，已经展示的数据行仍然保留。'
      ),
      example: `import { sliceByFrameBudget } from '@migaia/serialize/core'

try {
  for await (const rows of sliceByFrameBudget(importRows, {
    ...importBatchOptions,
    signal: viewSignal
  })) {
    appendImportRows(rows)
  }
} catch (error) {
  handleImportStopped(error)
}`,
      result: t(
        'Closing the view stops later batches without undoing the rows it already consumed.',
        '视图关闭后停止后续批次，不撤销已消费的数据行。'
      ),
      covers: ['signal']
    }
  ],
  IEncodeStreamOptions: [
    {
      title: t('Write independent export chunks in order', '按顺序写入独立导出分块'),
      problem: t(
        'The export owns a registered JSON parser and batch policy. Select that format, label its failures and allow two encodes in flight without changing source order.',
        '导出已经持有登记的 JSON 解析器与分批策略。选择该格式、标记失败，并允许两个编码操作在途，同时保持源顺序。'
      ),
      example: `import { encodeStream } from '@migaia/serialize/core'

for await (const chunk of encodeStream(registry, exportRows, {
  ...exportBatchOptions,
  type: 'json',
  context: 'orders-export',
  maxInFlight: 2
})) {
  await writeExportChunk(chunk)
}`,
      result: t(
        'The writer receives independent encoded arrays in source order, rather than one concatenated JSON document.',
        '写入器按源顺序接收独立编码数组，而不是一个直接拼接的 JSON 文档。'
      ),
      covers: ['type', 'context', 'maxInFlight']
    },
    {
      title: t('Choose an export slice budget', '选择导出的切片预算'),
      problem: t(
        'A desktop export should leave time for UI work while encoding many rows. Configure its batch adaptation separately from the output format and request context.',
        '桌面导出需要在编码大量数据行时给界面执行机会。将批次自适应配置与输出格式、请求上下文分别设置。'
      ),
      example: `import { encodeStream } from '@migaia/serialize/core'

for await (const chunk of encodeStream(registry, exportRows, {
  targetMs: 8,
  minItems: 10,
  maxItems: 200,
  initialItems: 20,
  scheduler: exportScheduler,
  yieldTo: () => waitForNextPaint()
})) {
  await writeExportChunk(chunk)
}`,
      result: t(
        'Encoding uses bounded adaptive batches and gives the host an opportunity between slices.',
        '编码使用有界自适应批次，并在切片之间给宿主执行机会。'
      ),
      covers: ['targetMs', 'minItems', 'maxItems', 'initialItems', 'scheduler', 'yieldTo']
    },
    {
      title: t('Stop an export when its request ends', '请求结束后停止导出'),
      problem: t(
        'A closed request no longer needs encoded rows. Pass its signal so owned stream work can stop; the borrowed registry remains owned by the application.',
        '请求结束后不再需要编码数据行。传入其信号，让流拥有的工作可以停止；借用的注册表仍由应用持有。'
      ),
      example: `import { encodeStream } from '@migaia/serialize/core'

try {
  for await (const chunk of encodeStream(registry, exportRows, {
    ...exportBatchOptions,
    signal: requestSignal
  })) {
    await writeExportChunk(chunk)
  }
} catch (error) {
  showExportError(error)
}`,
      result: t(
        'Cancellation stops later chunks and lets the application show the export outcome.',
        '取消会停止后续分块，应用可展示导出结果。'
      ),
      covers: ['signal']
    }
  ],
  decodeStream: [
    {
      title: t('Read downloaded invoice chunks', '读取下载的发票分块'),
      problem: t(
        'A download identifies its registered format and request lifetime. Decode each chunk with that parser, keeping the download context on failures instead of merging unrelated chunks.',
        '下载已经确定登记格式与请求生命周期。用该解析器逐块解码，失败时保留下载上下文，不合并彼此独立的分块。'
      ),
      example: `import { decodeStream } from '@migaia/serialize/core'

for await (const invoices of decodeStream(registry, downloadChunks, {
  type: 'json',
  context: 'invoice-download',
  signal: requestSignal
})) {
  appendDownloadedInvoices(invoices)
}`,
      result: t(
        'The invoice view receives each independent decoded value in download order.',
        '发票视图按下载顺序接收每个独立解码值。'
      ),
      covers: ['type', 'context', 'signal']
    },
    {
      title: t('Handle a cancelled download', '处理已取消的下载'),
      problem: t(
        'A route can close while its response is buffered. The route signal stops decoding before another value is delivered, so the closed page does not continue adding invoices.',
        '响应已缓冲时，路由也可能关闭。路由信号会在交付下一值前停止解码，已关闭页面不再继续追加发票。'
      ),
      example: `import { decodeStream } from '@migaia/serialize/core'

try {
  for await (const invoices of decodeStream(registry, downloadChunks, {
    type: 'json',
    context: 'invoice-download',
    signal: routeSignal
  })) {
    appendDownloadedInvoices(invoices)
  }
} catch (error) {
  handleDownloadStopped(error)
}`,
      result: t(
        'A cancelled route receives no further decoded invoices.',
        '路由取消后不再收到后续解码发票。'
      ),
      covers: ['type', 'context', 'signal']
    }
  ],
  IJsonPluginOptions: [
    {
      title: t('Save readable settings without session data', '保存可读配置并排除会话数据'),
      problem: t(
        'A settings file should be readable in an editor, but session data must stay local. Native JSON replacement selects fields and space sets indentation.',
        '设置文件需要便于在编辑器中阅读，会话数据却必须留在本地。原生 JSON 替换回调选择字段，space 设置缩进。'
      ),
      example: `import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize'

const registry = createSerializeRegistry([jsonPlugin({
  replacer: (key, value) => key === 'session' ? undefined : value,
  space: 2
})])
await saveSettingsFile(await registry.encode(editorSettings))
await registry.dispose()`,
      result: t(
        'The saved file has two-space indentation and omits the session field.',
        '保存文件使用两空格缩进，并省略 session 字段。'
      ),
      covers: ['replacer', 'space']
    },
    {
      title: t('Restore the last-saved date from JSON bytes', '从 JSON 字节恢复最后保存时间'),
      problem: t(
        'Downloaded settings arrive as bytes and store a date as text. A strict byte decoder rejects damaged UTF-8; the native JSON reviver restores the application date field.',
        '下载配置以字节形式到达，其中日期保存为文本。严格字节解码器拒绝损坏的 UTF-8，原生 JSON reviver 恢复应用日期字段。'
      ),
      example: `import { jsonParser } from '@migaia/serialize/plugins'

const parser = jsonParser({
  decoder: new TextDecoder('utf-8', { fatal: true }),
  reviver: (key, value) => key === 'updatedAt' ? new Date(value as string) : value
})
const settings = await parser.decode(downloadedSettings, {
  signal: requestSignal,
  context: 'editor-settings'
}) as { updatedAt: Date }
renderLastSaved(settings.updatedAt)
await parser.dispose?.()`,
      result: t(
        'The editor receives a Date for updatedAt, instead of displaying the raw saved string.',
        '编辑器取得 Date 类型的 updatedAt，不再直接展示保存的字符串。'
      ),
      covers: ['decoder', 'reviver']
    }
  ],
  ISerializeRegistryOptions: [
    {
      title: t('Assemble a text header with binary output', '拼装文本头与二进制输出'),
      problem: t(
        'An application parser emits a text header followed by byte chunks. Provide the host encoder so the registry can assemble that mixed output; this does not change parser-specific decoding.',
        '应用解析器先输出文本头，再输出字节分块。提供宿主编码器，让注册表可以拼装混合输出；这不会改变解析器自己的解码策略。'
      ),
      example: `import { createSerializeRegistry } from '@migaia/serialize'

const registry = createSerializeRegistry(applicationParsers, {
  encoder: new TextEncoder()
})
await sendReport(await registry.encode(reportData))
await registry.dispose()`,
      result: t(
        'The report contains the encoded header followed by the parser byte payload.',
        '报表包含编码后的文本头，以及解析器产生的字节载荷。'
      ),
      covers: ['encoder']
    },
    {
      title: t('Report cleanup failure outside the close result', '在关闭结果之外处理清理失败'),
      problem: t(
        'Parser cleanup may fail after a document closes. The default policy rejects disposal; report is appropriate when the application deliberately handles cleanup diagnostics through monitoring.',
        '文档关闭后，解析器清理仍可能失败。默认策略使销毁拒绝；应用明确通过监控处理清理诊断时，可使用 report。'
      ),
      example: `import { createSerializeRegistry } from '@migaia/serialize'

const registry = createSerializeRegistry(applicationParsers, {
  cleanup: {
    policy: 'report',
    report: (diagnostic) => reportCleanupDiagnostic(diagnostic)
  }
})
onEditorClosed(() => registry.dispose())`,
      result: t(
        'A parser cleanup failure reaches monitoring while the report-policy disposal can finish.',
        '解析器清理失败会交给监控，report 策略的销毁仍可完成。'
      ),
      covers: ['cleanup', 'cleanup.policy', 'cleanup.report']
    },
    {
      title: t('Observe work that outlives the editor', '观察超过编辑器生命周期的工作'),
      problem: t(
        'A parser can remain pending after the editor closes. The application clock bounds the disposal wait; a timeout callback updates the UI and report preserves a later parser rejection.',
        '编辑器关闭后，解析器仍可能待定。应用时钟限制销毁等待，超时回调更新界面，report 保留之后才到达的解析器拒绝。'
      ),
      example: `import { createSerializeRegistry } from '@migaia/serialize'

const registry = createSerializeRegistry(applicationParsers, {
  scheduler: applicationScheduler,
  onDrainTimeout: (diagnostic) => showPendingOperations(diagnostic.pendingCount),
  report: (error) => reportToMonitoring(error)
})
onPreviewRequested(async (value) => {
  try {
    renderPreview(await registry.encode(value))
  } catch (error) {
    showPreviewError(error)
  }
})
onEditorClosed(() => registry.dispose({
  deadlineAt: applicationScheduler.now() + 2000
}))`,
      result: t(
        'The editor can finish its bounded close wait, show pending work and still report a later parser failure.',
        '编辑器可结束限时关闭等待、显示未完成工作，并继续上报迟到的解析器失败。'
      ),
      covers: ['scheduler', 'onDrainTimeout', 'report']
    }
  ]
}

/** Application errors retain operation labels, primary failures and cleanup detail. */
const serializeErrorOptionCases = (name: string, secondary = false): readonly IOptionCaseDoc[] => [
  {
    title: t('Explain a saved-settings decode failure', '说明保存配置的解码失败'),
    problem: t(
      'The editor needs a readable restore message, while support needs the original decoder failure and the affected operation. Keep cause and a stable context label together.',
      '编辑器需要可读的恢复提示，支持人员仍需要原始解码失败及受影响操作。将 cause 与稳定的 context 标签一起保留。'
    ),
    example: `import { ${name}, SerializeErrorCode } from '@migaia/serialize/core'

try {
  await decodeSavedSettings(upload)
} catch (cause) {
  const error = ${name}(
    SerializeErrorCode.decodeFailed,
    'Saved settings rejected',
    { cause, context: 'editor-settings' }
  )
  showSettingsError(error.message)
  reportToMonitoring(error)
}`,
    result: t(
      'The editor explains the failure; monitoring retains the original cause under editor-settings.',
      '编辑器说明失败，监控在 editor-settings 上下文下保留原始原因。'
    ),
    covers: ['cause', 'context']
  },
  {
    title: t('Keep import failure and cleanup detail together', '一起保留导入失败与清理详情'),
    problem: t(
      'A settings import can fail before its input resources are released. Keep cleanup failures alongside the primary decode failure so the operator can diagnose both operations.',
      '设置导入可能在输入资源释放前失败。将清理失败与主要解码失败一起保留，方便操作人员排查两项操作。'
    ),
    example: `import { ${name}, SerializeErrorCode } from '@migaia/serialize/core'

try {
  await importSettings(upload)
} catch (primary) {
  const cleanupErrors = await releaseImportInput()
  const error = ${name}(
    SerializeErrorCode.decodeFailed,
    'Settings import failed',
    {
      cause: ${secondary ? 'primary' : "new AggregateError([primary, ...cleanupErrors], 'Import and cleanup failed')"},
      context: 'settings-import'${secondary ? ',\n      errors: cleanupErrors' : ''}
    }
  )
  reportToMonitoring(error)
}`,
    result: t(
      'The import report retains the primary failure and input-cleanup failures under one operation label.',
      '导入报告在同一操作标签下保留主要失败及输入清理失败。'
    ),
    covers: secondary ? ['cause', 'context', 'errors'] : ['cause', 'context']
  }
]

/** Shared native error identity fields preserve the original runtime error class. */
const errorMembers: Readonly<Record<string, IMemberDoc>> = {
  source: {
    summary: t(
      'Identifies this package as `@migaia/serialize`; combine it with `code` when classifying failures.',
      '标识错误所属包为 `@migaia/serialize`；与 `code` 一起用于区分不同包的错误。'
    )
  },
  code: {
    summary: t(
      'Stable semantic failure code from `SerializeErrorCode`, independent from diagnostic message text.',
      '来自 `SerializeErrorCode` 的稳定语义错误码，调用者无需解析错误消息即可分类。'
    ),
    values: { enum: 'SerializeErrorCode' }
  },
  context: {
    summary: t(
      'Optional caller label copied from operation or error construction, identifying the affected resource.',
      '从操作或错误构造参数复制的调用者标签，用于定位受影响的数据或资源。'
    ),
    default: t(
      'Omitted when the caller provides no context label.',
      '调用者未提供标签时不设置此属性。'
    )
  }
}

/** Native error factories share cause and context option semantics. */
const nativeErrorOptions: Readonly<Record<string, IMemberDoc>> = {
  cause: {
    summary: t(
      'Original thrown value supplied by the caller; native cause retains its exact identity.',
      '调用者提供的原始抛出值，原生原因属性保留其精确身份。'
    ),
    default: t('Omitted; no cause property is constructed.', '默认省略，不构造原因属性。')
  },
  context: {
    summary: t(
      'Application-owned diagnostic label identifying the affected operation or resource.',
      '应用拥有的诊断标签，用于定位受影响操作或资源。'
    ),
    default: t('Omitted; no context property is attached.', '默认省略，不附加上下文属性。')
  }
}

/** Shared semantics of errors created by the native error factories. */
const errorExample = `import { createSerializeTypeError, SerializeErrorCode } from '@migaia/serialize/core'

const error = createSerializeTypeError(SerializeErrorCode.invalidOption, 'invalid settings', {
  context: 'settings'
})
console.log(error instanceof TypeError, error.source, error.code, error.context)`

/** All frame fields keep identical defaults when inherited by encode-stream options. */
const frameMembers: Readonly<Record<string, IMemberDoc>> = {
  targetMs: {
    summary: t(
      'Positive finite consumer processing budget in milliseconds; measured elapsed time adjusts the next slice size.',
      '消费者处理一片数据的目标毫秒数，必须为有限正数；实际耗时用于调整下一片大小。'
    ),
    default: t(
      '`8` milliseconds per slice; this is a target rather than a hard execution deadline.',
      '每片 `8` 毫秒；这是自适应目标，并非强制中断的截止时间。'
    )
  },
  minItems: {
    summary: t(
      'Positive safe integer lower bound on items per slice, reducing overhead from very small batches.',
      '每片条目数的正安全整数下限，用于避免批次过小带来的额外开销。'
    ),
    default: t(
      '`64` items, including the lower clamp applied to the initial slice.',
      '默认 `64` 条，首片大小同样受此下限约束。'
    )
  },
  maxItems: {
    summary: t(
      'Positive safe integer upper bound on items per slice; must be at least `minItems`.',
      '每片条目数的正安全整数上限，必须大于或等于 `minItems`。'
    ),
    default: t(
      '`250000` items; adaptive growth never exceeds this upper bound.',
      '默认 `250000` 条，自适应增长不会超过此上限。'
    )
  },
  initialItems: {
    summary: t(
      'Positive safe integer initial size before consumer timing is available; clamped between the item bounds.',
      '获得消费者耗时之前使用的首片正安全整数大小，会钳制在条目数上下限内。'
    ),
    default: t(
      '`2048` items before clamping to `minItems` and `maxItems`.',
      '默认 `2048` 条，再按 `minItems` 与 `maxItems` 钳制。'
    )
  },
  yieldTo: {
    whenToUse: t(
      'Use a host task or frame callback when consumers must let other work run between slices. The callback returns Promise<void>; rejection stops iteration. Omission schedules a zero-delay task through scheduler and observes cancellation.',
      '消费者需要在切片之间让其它工作运行时，使用宿主任务或帧回调。回调返回 Promise<void>，拒绝会终止迭代。省略时通过 scheduler 安排零延迟任务，并观察取消。'
    ),
    example: serializeOptionCases.IFrameBudgetOptions![0]!.example,
    summary: t(
      'Optional no-argument async callback invoked between slices. Resolve after yielding execution; a throw or rejection stops iteration.',
      '片与片之间调用的无参数异步回调；让出执行权后兑现，抛错或拒绝会终止迭代。'
    ),
    params: {},
    returns: t(
      'A `Promise<void>` whose fulfillment permits the next slice; rejection reaches the stream consumer.',
      '返回 `Promise<void>`，兑现后继续下一片，拒绝则传给流消费者。'
    ),
    default: t(
      'Schedules a zero-delay task with the supplied scheduler; its wait observes cancellation.',
      '默认经注入的调度器安排零延迟任务，等待过程可响应取消。'
    )
  },
  signal: {
    summary: t(
      'Caller-owned structural `IAbortSignal`, usually from `createAbortController().signal`, requests cooperative cancellation.',
      '调用者持有的结构化 `IAbortSignal`，通常取自 `createAbortController().signal`，用于请求协作式取消。'
    ),
    default: t(
      '`undefined`: no caller cancellation signal is installed.',
      '`undefined`：不安装调用者的取消信号。'
    )
  },
  scheduler: {
    summary: t(
      'Required `IScheduler`, with no default: `now()` returns finite monotonic milliseconds; `schedule(callback, delayMs)` asynchronously schedules the no-argument callback and returns a task with idempotent `cancel()` and optional `unref()`. An optional `defer(callback)` is part of the scheduler contract but is not required for slicing. Use `systemScheduler` from `@migaia/utils/scheduler` for host scheduling.',
      '必填 `IScheduler`，没有默认值：`now()` 返回有限单调毫秒数；`schedule(callback, delayMs)` 异步安排无参数回调，返回含幂等 `cancel()` 和可选 `unref()` 的任务。调度器契约还可提供 `defer(callback)`，切片本身不要求它。宿主调度可使用 `@migaia/utils/scheduler` 的 `systemScheduler`。'
    )
  }
}

/** Common required format version field, used by all format-specific codec factories. */
const versionMember: IMemberDoc = {
  summary: t(
    'Caller-selected positive safe integer identifying this codec wire version; no default is assigned and the exact literal type is retained.',
    '调用者指定的正安全整数，用于标识编解码器线格式版本；没有默认值，返回值保留该字面量类型。'
  )
}

/** Format codec methods share the same generic value ownership contract. */
const codecMembers: Readonly<Record<string, IMemberDoc>> = {
  id: {
    summary: t(
      'Codec format identifier fixed by its factory, such as `json`, `cbor`, `message-pack`, `protobuf` or `identity`.',
      '由工厂固定的格式标识，例如 `json`、`cbor`、`message-pack`、`protobuf` 或 `identity`。'
    )
  },
  version: {
    summary: t(
      'The version number supplied when creating this codec, which converts values to a data format and back. It identifies the format version that producers and consumers agree to use. The codec retains the number; changing the original construction options later does not change this property.',
      '创建编解码器时提供的版本号。编解码器负责把值转换成指定格式的数据并还原，此版本用于标识生产端与消费端约定的格式。该数字在创建时保存，之后修改原构造选项不会改变这个属性。'
    )
  },
  encodedType: {
    summary: t(
      'Declares the runtime representation produced by encoding so a transport can admit the correct payload shape.',
      '声明编码产物的运行时表示，让传输层选择正确的载荷形状校验方式。'
    ),
    values: {
      unknown: t(
        'Identity representation preserves any input without changing object identity.',
        '恒等表示，保留任意输入及其对象身份。'
      ),
      string: t(
        'Text representation emitted by the JSON format codec.',
        '文本表示，由原生 `JSON` 格式编解码器产生。'
      ),
      uint8array: t(
        'Byte representation emitted by CBOR, MessagePack and Protobuf codecs.',
        '字节表示，由 `CBOR`、`MessagePack` 与 `Protobuf` 编解码器产生。'
      )
    }
  },
  encode: {
    summary: t(
      'Synchronously converts the supplied application value to the codec representation; built-in format failures carry package codes and original causes.',
      '同步将应用值转换为编解码器的输出表示；内置格式失败携带包错误码并保留原始原因。'
    ),
    params: {
      value: t(
        'Application value admitted by this codec; portable formats accept `ICodecValue`, while Protobuf accepts its generated message shape.',
        '由应用提供、符合当前编解码器约束的值；可移植格式接收 `ICodecValue`，协议缓冲区格式接收生成的消息形状。'
      )
    },
    returns: t(
      'The encoded `TEncoded` value; identity returns the input itself, while format codecs return text or bytes.',
      '编码后的 `TEncoded`；恒等编解码器原样返回输入，其他格式返回文本或字节。'
    ),
    example: codecExample
  },
  decode: {
    summary: t(
      'Synchronously restores the application value from this codec representation; invalid portable data or malformed format data throws.',
      '同步从当前编解码器表示恢复应用值；不符合可移植约束或格式损坏的数据会抛错。'
    ),
    params: {
      value: t(
        'Encoded value returned by the matching codec encode operation, or received from a carrier using that format and version.',
        '由相同格式和版本的编码操作产生，或由使用该格式和版本的载体接收的编码值。'
      )
    },
    returns: t(
      'The decoded `TValue`; identity returns the same object, portable formats validate the result and Protobuf returns its message shape.',
      '解码后的 `TValue`；恒等编解码器保留对象身份，可移植格式校验结果，协议缓冲区格式返回对应消息形状。'
    ),
    example: codecExample
  }
}

/** Registered parser operations use one owner, regardless of the installed format. */
const registryMembers: Readonly<Record<string, IMemberDoc>> = {
  primaryType: {
    summary: t(
      'Default write and read type captured from the first plugin passed to `createSerializeRegistry`.',
      '从传给 `createSerializeRegistry` 的首个插件取得的默认读写格式标识。'
    )
  },
  types: {
    summary: t(
      'Snapshot of registered type strings in plugin order; no registration API adds formats after construction.',
      '按插件顺序记录构造时已注册的格式标识；构造后没有动态增加格式的接口。'
    )
  },
  has: {
    summary: t(
      'Checks whether a format is currently registered; returns false after disposal clears the parser table.',
      '检查指定格式当前是否在注册表中；销毁清空解析器表后返回假值。'
    ),
    params: {
      type: t(
        'Format tag copied from a stored envelope or chosen from this registry types list.',
        '取自存档封装头或当前注册表格式列表的格式标签。'
      )
    },
    returns: t(
      '`true` for a registered format, `false` otherwise; it does not start any parser work.',
      '格式存在时返回 `true`，否则返回 `false`，不会启动解析工作。'
    ),
    example: registryExample
  },
  encode: {
    summary: t(
      'Runs one parser and assembles its chunks into one complete result. Caller cancellation or close rejects promptly even if parser work ignores its signal.',
      '运行一个解析器并把其分块拼成完整结果；调用者取消或关闭时会及时拒绝，即使解析器忽略信号。'
    ),
    params: {
      value: t(
        'Application value supplied by the caller and admitted by the selected parser.',
        '调用者提供且被所选解析器接受的应用值。'
      ),
      options: t(
        'Optional operation fields: `type` defaults to the first plugin; `signal` defaults to no caller signal; `context` defaults to `anonymous`. Obtain type from plugin registration or an envelope and signal from an abort controller.',
        '可选操作字段：`type` 默认首个插件，`signal` 默认无调用者信号，`context` 默认 `anonymous`；格式取自插件注册或封装头，信号取自取消控制器。'
      )
    },
    returns: t(
      'A `Promise<ISerializeChunk>`: one value, concatenated text, or merged bytes. Rejects with `REGISTRY_DISPOSED`, `CODEC_NOT_FOUND`, `ABORTED`, `ENCODE_FAILED` or `INVALID_CHUNK`; parser failure remains on cause.',
      '返回 `Promise<ISerializeChunk>`，内容为单个值、拼接文本或合并字节；可能以 `REGISTRY_DISPOSED`、`CODEC_NOT_FOUND`、`ABORTED`、`ENCODE_FAILED` 或 `INVALID_CHUNK` 拒绝，解析器失败保留在原因链。'
    ),
    example: registryExample
  },
  decode: {
    summary: t(
      'Validates one chunk then runs its selected parser, preserving the original payload identity where the parser permits.',
      '校验一个分块后运行所选解析器；解析器允许时保留原始载荷的对象身份。'
    ),
    params: {
      chunk: t(
        'Chunk returned by encode or reconstructed from a stored envelope; select its original format through options.type.',
        '编码操作返回或由存档封装重建的分块，使用 `options.type` 选择其原始格式。'
      ),
      options: t(
        'Optional `type`, `signal` and `context`; defaults are the first plugin, no caller signal, and `anonymous`. Read type from the stored envelope, and signal from an abort controller.',
        '可选 `type`、`signal` 与 `context`；默认分别为首个插件、无调用者信号和 `anonymous`，格式取自存档封装头，信号取自取消控制器。'
      )
    },
    returns: t(
      'A promise of the parser result. Rejects on closure, unknown format, cancellation, malformed chunks or parser failure with `REGISTRY_DISPOSED`, `CODEC_NOT_FOUND`, `ABORTED`, `INVALID_CHUNK` or `DECODE_FAILED`.',
      '返回解析结果的承诺；关闭、未知格式、取消、坏分块或解析失败分别使用 `REGISTRY_DISPOSED`、`CODEC_NOT_FOUND`、`ABORTED`、`INVALID_CHUNK` 或 `DECODE_FAILED`。'
    ),
    example: registryExample
  },
  close: {
    summary: t(
      'Synchronously stops admission and aborts the registry closing signal. Repeated calls are harmless; parser disposers are not invoked here.',
      '同步停止接收新操作并取消注册表关闭信号；重复调用无额外影响，此处不调用解析器清理函数。'
    ),
    returns: t(
      'Admission is closed and running public operations observe cancellation; use dispose to wait for resource cleanup.',
      '新操作已被拒绝，正在运行的公开操作可观察到取消；资源清理需要调用 `dispose`。'
    ),
    example: registryExample
  },
  dispose: {
    summary: t(
      'Closes admission, drains pending parser work, then awaits owned parser disposers. Repeated calls return the same promise; the first admitted call fixes its deadline.',
      '关闭接收入口，排空待完成解析工作，再等待所属解析器清理；重复调用返回同一承诺，首个成功接收的调用固定截止时间。'
    ),
    params: {
      options: t(
        'Optional `deadlineAt`: finite absolute time in the construction scheduler clock. Default is no deadline; obtain it from scheduler.now() plus a duration. Expired deadlines skip draining but still clean parsers.',
        '可选 `deadlineAt` 是构造时调度器时钟域内的有限绝对时间，由 `scheduler.now()` 加时长取得；默认无截止时间，过期时跳过排空但仍清理解析器。'
      )
    },
    returns: t(
      'Shared `Promise<void>` settling after parser cleanup. A deadline emits a diagnostic rather than a timeout rejection; cleanup follows the configured throw or report policy.',
      '解析器清理结束后落定的共享 `Promise<void>`；排空到期产生诊断而非超时拒绝，清理失败按配置的抛出或报告策略处理。'
    ),
    example: registryExample
  }
}

/** Registry options are shared only with the factory that consumes this exact contract. */
const registryOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  scheduler: {
    summary: t(
      'Fixed `IScheduler` for disposal deadlines; provide it from `@migaia/utils/scheduler` or a compatible monotonic clock implementation.',
      '构造后固定、负责销毁截止时间的 `IScheduler`，可从 `@migaia/utils/scheduler` 取得或注入同等单调时钟实现。'
    ),
    default: t(
      '`systemScheduler` from `@migaia/utils/scheduler`.',
      '默认使用 `@migaia/utils/scheduler` 的 `systemScheduler`。'
    )
  },
  encoder: {
    summary: t(
      'Fixed `ITextEncoder` used to merge mixed text and byte parser output; its encode method retains the original receiver.',
      '用于合并文本与字节混合输出的固定 `ITextEncoder`，其编码方法保留原始接收者。'
    ),
    default: t(
      'A host `TextEncoder`; construction throws `ENV_UNSUPPORTED` when unavailable.',
      '默认构造宿主 `TextEncoder`；宿主缺失此能力时构造抛 `ENV_UNSUPPORTED`。'
    )
  },
  decoder: {
    example: `import { createSerializeRegistry } from '@migaia/serialize'

const registry = createSerializeRegistry(applicationParsers, {
  decoder: new TextDecoder('utf-8', { fatal: true })
})
await restoreEditorSettings(registry)
await registry.dispose()`,
    summary: t(
      'Fixed `ITextDecoder` capability captured and validated at construction; JSON plugin byte decoding has its own decoder option.',
      '构造时捕获并校验的固定 `ITextDecoder` 能力；`JSON` 插件的字节解码使用插件自身的解码器选项。'
    ),
    default: t(
      'A host `TextDecoder`; construction throws `ENV_UNSUPPORTED` when unavailable.',
      '默认构造宿主 `TextDecoder`；宿主缺失此能力时构造抛 `ENV_UNSUPPORTED`。'
    )
  },
  cleanup: {
    whenToUse: t(
      'Choose throw, the default, when callers should catch parser-disposal failures. Choose report with a required report callback when the application owns a separate cleanup error sink. Both policies keep an earlier primary failure intact.',
      '调用方需要捕获解析器销毁失败时，选择默认 throw。应用另有清理错误出口时，可选择 report，并提供必需的报告回调。两种策略都保留先前主失败。'
    ),
    example: serializeOptionCases.ISerializeRegistryOptions![1]!.example,
    summary: t(
      'Controls parser-disposer failure handling: throw retains cleanup failures in disposal rejection; report sends one diagnostic and preserves the primary outcome.',
      '控制解析器清理失败的处理：抛出策略将清理失败保留在销毁拒绝中，报告策略发送诊断并保留主结果。'
    ),
    default: t(
      '`{ policy: "throw" }`, so unhandled parser cleanup failures reject disposal.',
      '默认 `{ policy: "throw" }`，因此未处理的解析器清理失败会使销毁拒绝。'
    )
  },
  'cleanup.policy': {
    whenToUse: t(
      'Use throw to reject disposal after parser cleanup fails. Use report only with cleanup.report to observe the failure without making it the disposal rejection. Omission of the cleanup object selects throw.',
      '解析器清理失败后需要使销毁拒绝时选 throw。只有提供 cleanup.report 时才可选 report，在不改变销毁拒绝结果的情况下观察失败。省略 cleanup 对象时选 throw。'
    ),
    example: serializeOptionCases.ISerializeRegistryOptions![1]!.example,
    summary: t(
      'Chooses the cleanup error boundary; report requires cleanup.report and never changes an existing primary failure.',
      '选择清理错误边界；报告策略必须提供 `cleanup.report`，不会改变已有的主失败。'
    ),
    values: { enum: 'SerializeCleanupPolicy' }
  },
  'cleanup.report': {
    whenToUse: t(
      'Provide it when cleanup.policy is report. It receives the registry cleanup diagnostic once and returns void; its own throw is contained. It is unused with throw policy and mandatory with report policy.',
      'cleanup.policy 为 report 时提供。它接收一次注册表清理诊断，返回空值；自身抛错被限制在观察边界内。throw 策略不使用它，report 策略必须提供它。'
    ),
    example: serializeOptionCases.ISerializeRegistryOptions![1]!.example,
    summary: t(
      'Synchronous callback used only by report policy. Receives `d: ISerializeCleanupError` once after cleanup failure, returns nothing; thrown reporter failures are contained.',
      '仅报告策略使用的同步回调；清理失败后接收一次 `d: ISerializeCleanupError`，无需返回值，回调抛错被限制在观察边界内。'
    ),
    params: {
      d: t(
        'Cleanup diagnostic created by the registry with package source and original cleanup error.',
        '由注册表构造、含包来源及原始清理错误的诊断对象。'
      )
    },
    returns: t(
      'No return value is used; throwing does not change the disposal result.',
      '不使用返回值；抛错不会改变销毁结果。'
    )
  },
  onDrainTimeout: {
    whenToUse: t(
      'Use it to record pending work when disposal reaches its deadline. It does not cancel an uncooperative parser or prevent cleanup. Without it the deadline still works, but no application observer receives the diagnostic.',
      '需要记录销毁截止时间到达时的待完成工作量时设置。它不会强行终止忽略取消的解析器，也不阻止清理。省略时截止时间仍生效，但应用观察者不会收到诊断。'
    ),
    example: serializeOptionCases.ISerializeRegistryOptions![2]!.example,
    summary: t(
      'Synchronous observer receiving `d: ISerializeTimeoutDiagnostic` when draining reaches its deadline. Returns nothing; thrown observer failures are contained.',
      '排空达到截止时间时接收 `d: ISerializeTimeoutDiagnostic` 的同步观察回调；无需返回值，抛错不会阻断清理。'
    ),
    params: {
      d: t(
        'Registry-created diagnostic with deadline and current pending count.',
        '注册表生成的诊断，记录截止时间及当时的待完成数量。'
      )
    },
    returns: t(
      'No return value is used; parser cleanup proceeds even if the observer throws.',
      '不使用返回值；即使观察回调抛错，仍继续清理解析器。'
    ),
    default: t(
      'A fixed no-op observer; deadline behavior remains unchanged.',
      '默认固定空操作观察器，不改变截止时间处理行为。'
    )
  },
  report: {
    whenToUse: t(
      'Use it for failures that arrive after cancellation or an iterator cleanup boundary. Return void; reporting does not replace the operation result. Without it the fixed no-op reporter drops these diagnostics.',
      '需要观察取消后或迭代器清理边界之后到达的失败时设置。无需返回值，报告不会替换操作结果。省略时固定空操作报告器丢弃这些诊断。'
    ),
    example: serializeOptionCases.ISerializeRegistryOptions![2]!.example,
    summary: t(
      'Callback receiving secondary iterator-cleanup and detached late failures immediately, including after cancellation but before disposal completes; detached `ABORTED` remains observable. No return value changes the operation.',
      '接收次要迭代器清理与脱离后的迟到失败，取消后即报告，无需等到销毁完成；脱离后的 `ABORTED` 仍可观察，返回值不改变操作结果。'
    ),
    params: {
      error: t(
        'Failure observed at the registry boundary after a primary result or cleanup boundary. Parser failures may be SerializeCodecError values retaining the original failure on cause.',
        '注册表在主结果或清理边界之后观察到的失败；解析器失败可能由 SerializeCodecError 包装，原始失败保留在 cause 中。'
      )
    },
    returns: t(
      'No return value is used and the primary operation outcome is unchanged.',
      '不使用返回值，主操作结果保持不变。'
    ),
    default: t(
      'A fixed no-op reporter; supply a callback when late failure visibility is required.',
      '默认固定空操作报告器；需要观察迟到失败时显式提供回调。'
    )
  }
}

/** JSON parser callback options retain native JSON callback semantics. */
const jsonOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  replacer: {
    whenToUse: t(
      'Set it when an application field should be omitted or converted before writing native JSON. Returning undefined omits object properties; other returned values replace them. Omission uses native JSON conversion without a callback. The callback is synchronous.',
      '应用字段需要在写入原生 JSON 前省略或转换时设置。返回 undefined 会省略对象属性，其它返回值替换当前值。省略时只使用原生转换，不调用回调。回调必须同步返回。'
    ),
    example: serializeOptionCases.IJsonPluginOptions![0]!.example,
    summary: t(
      'Synchronous native JSON.stringify callback: key is the current property name, including empty root key; value is its current value. Return replacement or undefined to omit an object property; thrown errors reach the parser caller.',
      '传给原生 `JSON.stringify` 的同步回调：`key` 是当前属性名，根值时为空串，`value` 是当前值；返回替代值或用 `undefined` 省略对象属性，抛错传给解析器调用者。'
    ),
    params: {
      key: t(
        'Property name supplied by native JSON serialization, or the empty root key.',
        '原生 `JSON` 序列化提供的属性名，根值使用空字符串。'
      ),
      value: t(
        'Current value supplied by native JSON after its ordinary conversion steps.',
        '原生 `JSON` 完成常规转换步骤后提供的当前值。'
      )
    },
    returns: t(
      'Replacement value consumed synchronously by JSON.stringify; promises are ordinary values and are not awaited.',
      '由 `JSON.stringify` 同步消费的替代值；承诺对象按普通值处理，不会被等待。'
    ),
    default: t(
      'No replacer; native JSON serialization decides omission and conversion.',
      '默认无替换回调，由原生 `JSON` 规则决定省略与转换。'
    )
  },
  reviver: {
    whenToUse: t(
      'Set it when selected parsed fields need application types such as Date. Return a replacement, or undefined to delete the property. Omission keeps ordinary JSON values. It runs only for parsed text or bytes; value chunks pass through.',
      '已解析字段需要恢复为 Date 等应用类型时设置。返回替代值，或返回 undefined 删除属性。省略时保留普通 JSON 值。只在解析文本或字节时执行，值分块原样通过。'
    ),
    example: serializeOptionCases.IJsonPluginOptions![1]!.example,
    summary: t(
      'Synchronous native JSON.parse callback: key is the parsed property name and value is the parsed child. Return a replacement or undefined to remove it; thrown errors reach the parser caller. Value chunks bypass this callback.',
      '传给原生 `JSON.parse` 的同步回调：`key` 是已解析属性名，`value` 是已解析子值；返回替代值或用 `undefined` 删除属性，抛错传给调用者；值分块跳过此回调。'
    ),
    params: {
      key: t(
        'Property name supplied during native JSON parse traversal, including the empty root key.',
        '原生 `JSON` 解析遍历提供的属性名，也包含根值使用的空字符串。'
      ),
      value: t(
        'Parsed child value supplied by native JSON before replacement.',
        '原生 `JSON` 在替换之前提供的已解析子值。'
      )
    },
    returns: t(
      'Replacement value consumed synchronously; async restoration is unsupported.',
      '同步返回的替代值，不支持异步还原。'
    ),
    default: t(
      'No reviver; parsed JSON values keep their native shapes.',
      '默认无还原回调，解析结果保留原生 `JSON` 形状。'
    )
  },
  space: {
    summary: t(
      'Native JSON indentation width. Numeric values are clamped by JSON.stringify to the range zero through ten.',
      '传给原生 `JSON` 的数字缩进宽度；`JSON.stringify` 会将其限制为零到十之间。'
    ),
    default: t(
      'No indentation; native JSON.stringify emits compact text.',
      '默认不缩进，原生 `JSON.stringify` 输出紧凑文本。'
    )
  },
  decoder: {
    summary: t(
      'Structural byte-to-text decoder used only for byte chunks before JSON.parse. Its throw reaches the direct parser caller or is wrapped by a registry.',
      '仅在字节分块上、`JSON` 解析前执行的结构化字节转文本解码器；抛错直接传给解析器调用者，或被注册表包装。'
    ),
    default: t(
      'Creates a host TextDecoder when byte decoding is needed; absence then throws ENV_UNSUPPORTED.',
      '字节解码时默认创建宿主 `TextDecoder`，此时能力缺失会抛 `ENV_UNSUPPORTED`。'
    )
  }
}

/** Stable enum documentation is reused by runtime constants and related union types. */
const enumDocs = {
  SerializeChunkKind: {
    summary: t(
      'Discriminates the payload representation at chunk tuple index zero.',
      '区分分块元组第零项所声明的载荷表示方式，决定后续拼装路径。'
    ),
    values: {
      value: t(
        'A complete arbitrary value; use when storage or transport already preserves structured values.',
        '完整的任意值；存储或传输已经保留结构化值时使用。'
      ),
      text: t(
        'Wire text that can be concatenated with other text chunks.',
        '可与其他文本分块直接拼接的线格式文本。'
      ),
      bytes: t(
        'Wire bytes carried by Uint8Array; mixed text is encoded before byte assembly.',
        '由 `Uint8Array` 携带的线格式字节，混合文本在拼装前先编码。'
      )
    }
  },
  SerializeCleanupKind: {
    summary: t(
      'Distinguishes cleanup failures from drain-deadline diagnostics.',
      '区分解析器清理失败与排空截止时间诊断，供观察回调选择处理方式。'
    ),
    values: {
      cleanupError: t(
        'A parser disposer failed; delivered to the report cleanup policy callback.',
        '解析器清理函数失败，交给报告清理策略的回调处理。'
      ),
      drainTimeout: t(
        'Draining reached its deadline; parser cleanup continues after the observer is notified.',
        '排空达到截止时间，通知观察回调后继续清理解析器。'
      )
    }
  },
  SerializeCleanupPolicy: {
    summary: t(
      'Selects how disposal exposes parser cleanup errors.',
      '决定销毁操作如何暴露解析器清理错误，选择拒绝或通知报告回调。'
    ),
    values: {
      throw: t(
        'Reject disposal on parser cleanup failure while retaining any earlier primary failure.',
        '解析器清理失败时拒绝销毁，并保留先前的主失败。'
      ),
      report: t(
        'Send a cleanup diagnostic to the required reporter without changing the disposal primary outcome.',
        '向必填报告回调发送清理诊断，不改变销毁的主结果。'
      )
    }
  },
  SerializeOutput: {
    summary: t(
      'Describes output representations for consumers and persistence adapters.',
      '供消费者与持久化适配器描述输出的表示形式。'
    ),
    values: {
      text: t(
        'Choose text output for carriers that store or embed strings.',
        '用于存储或嵌入字符串的载体所需的文本输出。'
      ),
      structured: t(
        'Choose structured output when the carrier stores values without wire encoding.',
        '载体可直接存储值、无需线格式编码时使用的结构化输出。'
      ),
      binary: t(
        'Choose binary output for byte-oriented transport or storage.',
        '面向字节的传输或存储所需的二进制输出。'
      )
    }
  },
  SerializePhase: {
    summary: t(
      'Error-location labels identifying which serialization operation owns a failure position. These constants emit no instrumentation events.',
      '标识失败位置属于编码操作还是解码操作，供错误诊断区分处理方向；这些常量不会发出监测事件。'
    ),
    values: {
      encode: t(
        'The failure arose while producing or collecting encoded output.',
        '失败发生于产生编码输出或收集编码分块期间。'
      ),
      decode: t(
        'The failure arose while validating or decoding an input chunk.',
        '失败发生于校验输入分块或解码分块期间。'
      )
    }
  },
  SerializePluginType: {
    summary: t(
      'Built-in registration tag used by jsonPlugin and jsonParser metadata.',
      '由内置 `JSON` 插件及解析器元数据使用的注册标签，供格式选择及存档封装使用。'
    ),
    values: {
      json: t(
        'Registers the native JSON parser under the JSON envelope format tag.',
        '以 `JSON` 封装格式标签注册原生 `JSON` 解析器。'
      )
    }
  },
  SerializeTextFormat: {
    summary: t(
      'Output-only formats accepted by emitOutput; these do not register input parsers.',
      '文本投影输出函数接受的只写格式，不会注册输入解析器。'
    ),
    values: {
      json: t(
        'Compact JSON for finite portable own data; the default output format.',
        '有限可移植自有数据的紧凑 `JSON` 表示，也是默认输出格式。'
      ),
      yaml: t(
        'YAML flow collections and quoted strings for the admitted portable graph.',
        '将已接纳的可移植图输出为 `YAML` 流式集合及带引号字符串。'
      ),
      toml: t(
        'TOML key assignments; root must be a record, null is rejected and strings require Unicode scalars.',
        '输出 `TOML` 键赋值；根必须为记录，拒绝空值，字符串要求有效统一码标量。'
      )
    }
  },
  CodecErrorText: {
    summary: t(
      'Stable diagnostic messages for standalone format codec boundaries.',
      '独立格式编解码器边界使用的稳定诊断消息集合。'
    ),
    values: {
      invalidVersion: t(
        'Used when a codec version is not a positive safe integer; correct factory options.',
        '编解码器版本不是正安全整数时使用，需要修正工厂选项。'
      ),
      invalidSchema: t(
        'Used when Protobuf schema identity or schema version fails admission.',
        '协议缓冲区模式标识或模式版本不符合接纳约束时使用。'
      ),
      encodeFailed: t(
        'Used when a format encoder fails; the original failure remains in the cause chain.',
        '格式编码器执行失败时使用，原始失败保留在原因链中。'
      ),
      decodeFailed: t(
        'Used when a format decoder fails; inspect the cause for format-specific detail.',
        '格式解码器执行失败时使用，可检查原因链中的具体格式失败。'
      ),
      portableValueInvalid: t(
        'Used when input or decoded output lies outside the accepted portable profile.',
        '输入或解码输出不符合当前接受的可移植数据约束时使用。'
      )
    }
  },
  SerializeErrorCode: {
    summary: t(
      'Package semantic error codes; classify with source rather than matching messages.',
      '包级语义错误码，应与来源一起分类，无需匹配消息文本。'
    ),
    values: {
      registryDisposed: t(
        'The registry has closed or begun disposal; create another registry for new work.',
        '注册表已关闭或开始销毁，新工作需要创建另一个注册表。'
      ),
      codecNotFound: t(
        'No parser matches the requested format tag; register the format or correct the envelope.',
        '没有解析器匹配请求的格式标签，需要注册对应格式或修正封装头。'
      ),
      encodeFailed: t(
        'A parser or stream encoder failed, or a registry parser produced no chunks.',
        '解析器或流编码失败，或注册表解析器没有产生任何分块。'
      ),
      decodeFailed: t(
        'A parser or stream decoder failed; retain the cause and position fields for diagnosis.',
        '解析器或流解码失败，应保留原因链与位置字段以便诊断。'
      ),
      invalidChunk: t(
        'A chunk tuple, payload kind or wire-only conversion is invalid; inspect parser output or stored data.',
        '分块元组、载荷种类或只接受线格式的转换非法，应检查解析器输出或存档数据。'
      ),
      aborted: t(
        'Cancellation won the operation; retry only with suitable application policy and a fresh signal.',
        '取消先于操作完成，仅按应用策略并使用新信号重试。'
      ),
      invalidOption: t(
        'A registration, scheduler, version, frame option or portable output input is invalid.',
        '注册、调度器、版本、切片选项或可移植文本输出输入不合法。'
      ),
      envUnsupported: t(
        'Required host encoding capability is absent; inject a compatible encoder or decoder.',
        '必需的宿主编码能力缺失，需要注入兼容的编码器或解码器。'
      )
    }
  }
} as const

/** One native tagged-error type, reused only where native base class differs. */
function taggedType(summary: IText): ITypeDoc {
  return {
    summary,
    scenarios: [
      t(
        'Classify failures without losing the original native error class or stack.',
        '分类失败时保留原生错误类型、原始堆栈和原因链。'
      )
    ],
    example: errorExample,
    members: errorMembers
  }
}

/** Complete bilingual reference for every public serialize entry. */
export const serializeReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Combined entry for chunk protocols, JSON parser plugins, registry lifecycle and output projection. Start with createSerializeRegistry([jsonPlugin()]); standalone format codecs use their own subpaths.',
        '聚合分块协议、`JSON` 解析插件、注册表生命周期与文本投影输出；从 `createSerializeRegistry([jsonPlugin()])` 开始，独立格式编解码器从各自子路径导入。'
      ),
      example: registryExample
    },
    codec: {
      summary: t(
        'Use this entry when defining a synchronous encoder/decoder or checking values before passing them to a format codec. `asCodecValue` validates supported plain data without copying it; `createPortableWalker` builds a traversal whose callbacks define how values are checked or transformed.\n\nImport this subpath for codec contracts and validation tools beyond the root’s selected exports. It does not select a data format or register parsers; use `codecs/*` or `registry` for those tasks.',
        '定义同步编解码器，或在交给格式编解码器前检查数据时，使用此入口。`asCodecValue` 校验支持的普通数据而不复制输入；`createPortableWalker` 创建遍历器，由回调决定如何检查或转换数据。\n\n此子路径提供编解码契约与校验工具，范围比根入口的部分导出更完整。它不选择数据格式，也不注册解析器；这些任务分别由 `codecs/*` 和 `registry` 负责。'
      ),
      example: walkerExample
    },
    'codecs/cbor': {
      summary: t(
        'Use this entry when both ends need to encode plain data as CBOR bytes and decode it back. `defineCBORCodec({ version: 1 })` creates a synchronous codec with `encode` and `decode` methods and an explicit version.\n\nImport this format subpath because the root does not export the factory. Install `cbor-x` for this format; the codec is not a registry plugin.',
        '双方需要将普通数据编码为 `CBOR` 格式并还原时，使用此入口。`defineCBORCodec({ version: 1 })` 创建同步编解码器，提供 `encode`、`decode` 方法及明确的版本。\n\n根入口不导出这个工厂，因此从此格式子路径导入。此格式需要安装 `cbor-x`；生成的编解码器不能直接当作注册表插件使用。'
      ),
      example: `import { defineCBORCodec } from '@migaia/serialize/codecs/cbor'
const codec = defineCBORCodec({ version: 1 })
console.log(codec.decode(codec.encode({ count: 2 })))`
    },
    'codecs/identity/v1': {
      summary: t(
        'Use this entry when a carrier already accepts the values you send and no format conversion is needed. `identityCodec.encode` and `identityCodec.decode` return the exact input unchanged, retaining its type.\n\nImport this versioned subpath for the identity codec, which the root does not export. It does not copy or validate application values, so choose a format codec when you need text or bytes.',
        '底层通信通道已经能接收原值，不需要格式转换时，使用此入口。`identityCodec.encode` 和 `identityCodec.decode` 都原样返回输入，并保留其类型。\n\n根入口不导出此编解码器，因此从这个带版本的子路径导入。它不复制或校验业务数据；需要文本或字节时，应选择具体的格式编解码器。'
      ),
      example: `import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
console.log(identityCodec.decode(identityCodec.encode({ count: 2 })))`
    },
    'codecs/json': {
      summary: t(
        'Use this entry when both ends need to encode plain data as JSON text and decode it back. `defineJsonCodec({ version: 1 })` creates a synchronous codec with `encode` and `decode` methods and an explicit version.\n\nImport this format subpath because the root does not export the factory. For a registry plugin instead of a standalone codec, use `jsonPlugin` from `plugins`.',
        '双方需要将普通数据编码为 `JSON` 格式并还原时，使用此入口。`defineJsonCodec({ version: 1 })` 创建同步编解码器，提供 `encode`、`decode` 方法及明确的版本。\n\n根入口不导出这个工厂，因此从此格式子路径导入。需要注册表插件而非独立编解码器时，使用 `plugins` 的 `jsonPlugin`。'
      ),
      example: codecExample
    },
    'codecs/message-pack': {
      summary: t(
        'Use this entry when both ends need to encode plain data as MessagePack bytes and decode it back. `defineMessagePackCodec({ version: 1 })` creates a synchronous codec with `encode` and `decode` methods and an explicit version.\n\nImport this format subpath because the root does not export the factory. Install `@msgpack/msgpack` for this format; the codec is not a registry plugin.',
        '双方需要将普通数据编码为 `MessagePack` 格式并还原时，使用此入口。`defineMessagePackCodec({ version: 1 })` 创建同步编解码器，提供 `encode`、`decode` 方法及明确的版本。\n\n根入口不导出这个工厂，因此从此格式子路径导入。此格式需要安装 `@msgpack/msgpack`；生成的编解码器不能直接当作注册表插件使用。'
      ),
      example: `import { defineMessagePackCodec } from '@migaia/serialize/codecs/message-pack'
const codec = defineMessagePackCodec({ version: 1 })
console.log(codec.decode(codec.encode([1, 2])))`
    },
    'codecs/protobuf': {
      summary: t(
        'Use this entry when exchanging Protobuf messages described by a generated Buf message descriptor. `defineProtobufCodec` takes that descriptor, a codec version and a separate schema identity, then returns synchronous methods for encoding to bytes and decoding messages.\n\nImport this subpath because the root does not export the factory, and install `@bufbuild/protobuf`. Unlike the plain-data codecs, this codec uses the supplied message schema to determine the data shape.',
        '需要传递由 `Buf` 生成的消息描述符定义的 `Protobuf` 消息时，使用此入口。`defineProtobufCodec` 接收描述符、编解码器版本和独立的数据模式标识，再提供同步的字节编码与消息解码方法。\n\n根入口不导出这个工厂，因此从此子路径导入，并安装 `@bufbuild/protobuf`。与普通数据编解码器相比，这里的数据形状由传入的消息模式决定。'
      ),
      example: `import { defineProtobufCodec } from '@migaia/serialize/codecs/protobuf'
import { FileDescriptorProtoSchema } from '@bufbuild/protobuf/wkt'
import { create } from '@bufbuild/protobuf'
const codec = defineProtobufCodec({ version: 1, schema: { id: 'file-descriptor', version: 1 }, binding: FileDescriptorProtoSchema })
console.log(codec.decode(codec.encode(create(FileDescriptorProtoSchema, { name: 'demo.proto' }))))`
    },
    core: {
      summary: t(
        'Use this entry for chunk and stream operations without setting up a parser registry. `sliceByFrameBudget` divides an array into work slices using the scheduler you supply; `collectStream` assembles chunks when you need one complete result.\n\nThe root re-exports these operations; this subpath names the lower-level tools directly. Format selection and parser ownership belong to the format codecs and `registry`, and collecting a stream keeps its data in memory.',
        '只需要处理数据块与数据流、不需要建立解析器注册表时，使用此入口。`sliceByFrameBudget` 利用你提供的调度器把数组分批交给调用方处理；`collectStream` 在需要完整结果时合并数据块。\n\n根入口也导出这些操作，此子路径便于直接选用底层工具。格式选择与解析器管理由具体格式编解码器和 `registry` 负责；合并流会把数据保留在内存中。'
      ),
      example: `import { sliceByFrameBudget } from '@migaia/serialize/core'
import { systemScheduler } from '@migaia/utils/scheduler'
for await (const rows of sliceByFrameBudget([1, 2, 3], { scheduler: systemScheduler })) console.log(rows)`
    },
    plugins: {
      summary: t(
        'Use this entry when adding the built-in JSON parser to a serialization registry. `jsonPlugin` creates the plugin that a registry accepts; `jsonParser` creates the parser itself for direct calls with an explicit context.\n\nThe root also exports both factories, while this subpath groups the parser tools. For a standalone versioned codec with synchronous value-to-text methods, use `codecs/json` instead.',
        '需要给序列化注册表安装内置的 `JSON` 解析器时，使用此入口。`jsonPlugin` 创建注册表接收的插件，`jsonParser` 则创建解析器本身，供传入明确上下文后直接调用。\n\n根入口也导出这两个工厂，此子路径集中提供解析器工具。若需要独立、带版本且同步转换值与文本的编解码器，应使用 `codecs/json`。'
      ),
      example: registryExample
    },
    registry: {
      summary: t(
        'Use this entry when your application must register parsers, choose a format, and encode or decode chunks through one managed object. `createSerializeRegistry` takes parser plugins and returns that registry; call `close()` to stop new work and await `dispose()` to release resources.\n\nThe root also exports this factory, while this subpath focuses on registry management and chunk conversion. It does not supply format plugins; obtain those from `plugins`.',
        '应用需要注册解析器、选择格式，并通过同一个管理对象编解码数据块时，使用此入口。`createSerializeRegistry` 接收解析器插件并创建注册表；用 `close()` 停止新工作，再等待 `dispose()` 释放资源。\n\n根入口也导出这个工厂，此子路径集中提供注册表管理与数据块转换。它不提供格式插件，插件由 `plugins` 提供。'
      ),
      example: registryExample
    }
  },
  symbols: {
    emitOutput: {
      role: 'operation',
      purpose: t(
        'Synchronously emits a complete management projection as JSON, YAML or TOML. Copies own enumerable data without invoking getters or serialization hooks; rejects cycles, nonfinite numbers and unsupported values before producing output.',
        '同步把管理投影完整输出为 `JSON`、`YAML` 或 `TOML`；复制自有可枚举数据，不执行访问器或序列化钩子，在输出前拒绝环、非有限数字与不支持的值。'
      ),
      params: {
        value: t(
          'Required caller-owned data: `null`, booleans, finite numbers, strings, dense arrays or plain/null-prototype records recursively containing these values. Own enumerable fields must be data properties; accessors, symbol keys, undefined, bigint, functions, cycles and class instances are rejected. TOML further requires a record root, no nested `null`, and Unicode scalar strings. The caller chooses field names such as `theme` and `retries`; they are not emitter options.',
          '调用方必填数据：`null`、布尔值、有限数字、字符串、稠密数组，或递归包含这些值的普通及空原型记录。自有可枚举字段必须是数据属性；拒绝访问器、符号键、`undefined`、大整数、函数、环和类实例。TOML 还要求根为记录、不含嵌套 `null`，字符串为 Unicode 标量。`theme`、`retries` 等字段名由调用方选择，不是输出器选项。'
        ),
        format: t(
          'Optional `SerializeTextFormat`: `json` (the default) emits one JSON value, `yaml` emits valid flow-style YAML, and `toml` emits record assignments. These are the only three values. This selects a text emitter, not an input parser or registry plugin.',
          '可选 `SerializeTextFormat`，只有三种值：默认 `json` 输出一个 JSON 值，`yaml` 输出合法的流式 YAML，`toml` 输出记录赋值语句。只选择文本输出器，不安装输入解析器或注册表插件。'
        )
      },
      returns: t(
        'One complete string. Rejected format or graph throws native TypeError with INVALID_OPTION and no partial output.',
        '返回一个完整字符串；格式或数据图不被接受时抛带 `INVALID_OPTION` 的原生 `TypeError`，不产生部分输出。'
      ),
      exampleIntro: serializeCases.emitOutput![0]!.problem,
      example: serializeCases.emitOutput![0]!.example,
      exampleResult: serializeCases.emitOutput![0]!.result,
      cases: serializeCases.emitOutput
    },
    asCodecValue: {
      role: 'operation',
      purpose: t(
        'Validates a decoded value against the legacy portable profile and narrows it to ICodecValue without copying, replacing or freezing it. Native bytes, unsupported prototypes and malformed portable bytes tags reject.',
        '按旧版可移植约束校验解码值，并将其收窄为 `ICodecValue`；不复制、不替换、不冻结，原生字节、不支持的原型和坏字节标签会被拒绝。'
      ),
      params: {
        value: t(
          'Unknown value produced by a parser or supplied by the application for portable-profile admission.',
          '由解析器产生或应用提供、尚未通过可移植约束校验的未知值。'
        )
      },
      returns: t(
        'The exact same input typed as ICodecValue; profile violations throw TypeError with INVALID_OPTION; errors raised by caller getters or proxy traps can propagate unchanged.',
        '返回与输入完全相同的对象，仅类型收窄为 `ICodecValue`；约束违规抛带 `INVALID_OPTION` 的 `TypeError`，调用者访问器或代理陷阱抛错可原样传播。'
      ),
      example: `import { asCodecValue } from '@migaia/serialize/codec'
const input: unknown = { count: 2 }
console.log(asCodecValue(input) === input)`
    },
    assertPortableValue: {
      role: 'operation',
      purpose: t(
        'Validates the decoded legacy portable profile without replacing or freezing caller data. Traverses arrays and ordinary or null-prototype records; rejects cycles, invalid scalars and unsupported binary or rich objects.',
        '校验已解码的旧版可移植数据，不替换或冻结调用者数据；遍历数组及普通或空原型记录，拒绝环、非法标量和不支持的二进制或富对象。'
      ),
      params: {
        value: t(
          'Decoded application value whose portable shape must be checked.',
          '需要检查可移植形状的已解码应用值。'
        ),
        active: t(
          'Optional ancestor set owned by an enclosing traversal; defaults to a new empty Set. Existing entries are treated as active ancestors.',
          '可选的外层遍历祖先集合，默认新建空 `Set`，已有条目会被视为当前活动祖先。'
        )
      },
      returns: t(
        'Returns normally when admitted; profile violations throw TypeError with INVALID_OPTION, while caller property-access failures can propagate unchanged. Input identity and mutability are retained.',
        '被接纳时正常返回，约束违规抛带 `INVALID_OPTION` 的 `TypeError`，调用者属性访问失败可原样传播；输入身份及可变性保持不变。'
      ),
      example: `import { assertPortableValue } from '@migaia/serialize/codec'
const value = { count: 2 }
assertPortableValue(value)
console.log(value)`
    },
    createPortableWalker: {
      role: 'factory',
      purpose: t(
        'Creates a synchronous specialized walker with policy callbacks captured once. The returned callable projects a value and byte metadata; its value method avoids metadata collection. Policy callbacks own validation and coded errors, and traversal owns cycle tracking.',
        '创建同步专用遍历器，一次捕获策略回调；返回的可调用值产生投影与字节元数据，其 `value` 方法跳过元数据收集；策略负责校验及带码错误，遍历器负责环追踪。'
      ),
      params: {
        strategy: t(
          'Caller-owned IPortableWalkerStrategy with scalar, binary, record and violation hooks. Optional array, field-write and finish hooks specialize projection; callbacks are synchronous and throwing stops traversal.',
          '调用者提供的 `IPortableWalkerStrategy`，包含标量、二进制、记录和违规回调；可选数组、写字段及完成回调定制投影，全部同步执行，抛错终止遍历。'
        )
      },
      returns: t(
        'A callable walker(value, active?, initialDepth?, beforeNativeBinary?) returning { value, byteUpperBound, hasBinary }, plus walker.value with the same arguments returning only the projection. Input is caller-owned, active is an optional enclosing ancestor Set, initialDepth defaults to zero, and beforeNativeBinary is an optional no-argument throwing guard exposed to policy context rather than automatically called. byteUpperBound is conservative JSON/native-byte accounting, not an encoded measurement; hasBinary records inline or native binary presence. Failures use strategy.violation.',
        '返回可调用的遍历器，接收值、可选祖先集合、初始深度和原生字节守卫，返回含 `value`、`byteUpperBound`、`hasBinary` 的对象；其 `value` 方法接收同样参数仅返回投影，输入由调用者提供，祖先集合可从外层传入，默认新建集合及深度零；原生字节守卫为可选无参数抛错函数，仅暴露给策略上下文，不自动执行；字节上界为保守估算而非编码实测长度，二进制标记记录内联或原生字节，失败经策略违规回调传播。'
      ),
      example: walkerExample
    },
    normalizeCodecFailure: {
      role: 'operation',
      purpose: t(
        'Returns an already tagged serialize Error unchanged; otherwise wraps the original thrown value in a coded native TypeError. This prevents repeated format-codec wrapping while retaining an original cause.',
        '已带序列化包标识的 `Error` 原样返回，否则把原始抛出值包装为带码原生 `TypeError`，避免格式编解码器重复包装并保留原始原因。'
      ),
      params: {
        error: t(
          'Original thrown value captured by a format callback boundary.',
          '由格式回调边界捕获的原始抛出值。'
        ),
        code: t(
          'Fallback semantic code from SerializeErrorCode, used only when the error is not already serialize-tagged.',
          '来自 `SerializeErrorCode` 的后备语义码，仅在错误尚未带本包标识时使用。'
        ),
        message: t(
          'Fallback caller-owned diagnostic, usually selected from CodecErrorText.',
          '由调用者维护、通常取自 `CodecErrorText` 的后备诊断消息。'
        )
      },
      returns: t(
        'The original tagged Error, or a TypeError wrapper whose cause is exactly the original thrown value.',
        '返回原先已标记的 `Error`，或以原始抛出值作为同一原因对象的 `TypeError` 包装。'
      ),
      example: `import { normalizeCodecFailure, CodecErrorText } from '@migaia/serialize/codec'
import { SerializeErrorCode } from '@migaia/serialize/core'
const cause = new SyntaxError('invalid input')
console.log(normalizeCodecFailure(cause, SerializeErrorCode.decodeFailed, CodecErrorText.decodeFailed).cause === cause)`
    },
    toPortableValue: {
      role: 'operation',
      purpose: t(
        'Projects the legacy intermediate portable representation with sorted record keys and inline base64url byte tags. This projection is separate from decoded-value validation; unsupported rich binary objects and cycles reject.',
        '生成旧版中间可移植表示，对记录键排序并将字节内联为无填充字节标签；此投影与解码值校验分开，不支持的富二进制对象和环会被拒绝。'
      ),
      params: {
        value: t(
          'Application value to project; Uint8Array can become a portable bytes tag rather than retaining native storage.',
          '待投影的应用值；`Uint8Array` 可转为可移植字节标签，不保留原生存储。'
        ),
        active: t(
          'Optional active ancestor set from an enclosing traversal; defaults to a fresh empty Set.',
          '可选外层遍历活动祖先集合，默认新建空 `Set`。'
        )
      },
      returns: t(
        'The intermediate projection; this helper is not a general assertion of the final portable profile. Policy violations throw TypeError with INVALID_OPTION; caller property-access errors can propagate unchanged.',
        '返回中间投影，并非最终可移植约束的通用断言；策略违规抛带 `INVALID_OPTION` 的 `TypeError`，调用者属性访问错误可原样传播。'
      ),
      example: `import { toPortableValue } from '@migaia/serialize/codec'
console.log(toPortableValue({ bytes: new Uint8Array([1, 2]) }))`
    },
    defineJsonCodec: {
      options: 'IJsonCodecOptions',
      role: 'factory',
      purpose: t(
        'Creates a frozen synchronous JSON codec with explicit version metadata. Its portable profile admits null, booleans, finite numbers, strings, dense arrays and ordinary records; encoding validates and projects supported data before stringify, while decoding parses and validates without freezing the result. Unsupported scalars such as NaN reject rather than silently becoming null. This differs from the native-JSON registry plugin, and the version is not embedded in the encoded text.',
        '创建带显式版本元数据的冻结同步 JSON codec。portable 规则接纳 `null`、布尔值、有限数字、字符串、稠密数组与普通记录；编码先校验并投影支持的数据再字符串化，解码先解析再校验，不冻结结果。`NaN` 等不支持的标量会被拒绝，不会悄悄变成 `null`。这与保留原生 JSON 行为的注册表插件不同，版本也不会嵌入编码文本。'
      ),
      params: {
        options: t(
          'Required `IJsonCodecOptions` with exactly one documented field, `version`: a caller-selected positive safe integer. The object and field have no defaults; `1` is an explicit choice in the example.',
          '必填 `IJsonCodecOptions`，唯一字段 `version` 为调用方指定的正安全整数。对象及字段均无默认值，示例中的 `1` 是显式选择。'
        )
      },
      returns: t(
        'ICodec with id json, string output and the chosen version. Invalid options or portable values throw INVALID_OPTION; other encode/decode failures use ENCODE_FAILED or DECODE_FAILED with cause.',
        '返回标识为 `json`、输出字符串且携带所选版本的 `ICodec`；非法选项或可移植值使用 `INVALID_OPTION`，其他编解码失败使用 `ENCODE_FAILED` 或 `DECODE_FAILED` 并保留原因。'
      ),
      exampleIntro: serializeCases.defineJsonCodec![0]!.problem,
      example: serializeCases.defineJsonCodec![0]!.example,
      exampleResult: serializeCases.defineJsonCodec![0]!.result,
      cases: serializeCases.defineJsonCodec
    },
    defineCBORCodec: {
      options: 'ICborCodecOptions',
      role: 'factory',
      purpose: t(
        'Creates a frozen synchronous cbor-x codec for portable values, without records or host-specific extensions. Decoded bigint integers are converted to numbers only when they are exactly safe integers.',
        '创建面向可移植值的冻结同步 `cbor-x` 编解码器，不使用记录扩展或宿主专用扩展；解码的大整数仅在精确安全整数范围内转换为数字。'
      ),
      params: {
        options: t(
          'Required ICborCodecOptions with a caller-selected positive safe integer version; install cbor-x before importing this entry.',
          '必填 `ICborCodecOptions`，版本为调用者指定的正安全整数，导入此入口前需要安装 `cbor-x`。'
        )
      },
      returns: t(
        'ICodec with id cbor and Uint8Array output. Invalid versions or portable values use INVALID_OPTION; format failures retain cause with ENCODE_FAILED or DECODE_FAILED.',
        '返回标识为 `cbor`、输出 `Uint8Array` 的 `ICodec`；非法版本或可移植值使用 `INVALID_OPTION`，格式失败保留原因并使用 `ENCODE_FAILED` 或 `DECODE_FAILED`。'
      ),
      example: `import { defineCBORCodec } from '@migaia/serialize/codecs/cbor'
const codec = defineCBORCodec({ version: 1 })
console.log(codec.decode(codec.encode({ count: 2 })))`
    },
    defineMessagePackCodec: {
      options: 'IMessagePackCodecOptions',
      role: 'factory',
      purpose: t(
        'Creates a frozen synchronous MessagePack codec using @msgpack/msgpack, sorted record keys and no custom extensions. Portable admission is shared with the JSON and CBOR codecs.',
        '使用 `@msgpack/msgpack` 创建冻结同步 `MessagePack` 编解码器，对记录键排序且不使用自定义扩展，与 `JSON` 和 `CBOR` 共用可移植接纳规则。'
      ),
      params: {
        options: t(
          'Required IMessagePackCodecOptions with a caller-selected positive safe integer version; install @msgpack/msgpack before importing.',
          '必填 `IMessagePackCodecOptions`，版本由调用者指定为正安全整数，导入前需要安装 `@msgpack/msgpack`。'
        )
      },
      returns: t(
        'ICodec with id message-pack and Uint8Array output. Invalid version or profile uses INVALID_OPTION; format failures retain cause with ENCODE_FAILED or DECODE_FAILED.',
        '返回标识为 `message-pack`、输出 `Uint8Array` 的 `ICodec`；版本或数据约束非法时使用 `INVALID_OPTION`，格式失败保留原因并使用 `ENCODE_FAILED` 或 `DECODE_FAILED`。'
      ),
      example: `import { defineMessagePackCodec } from '@migaia/serialize/codecs/message-pack'
const codec = defineMessagePackCodec({ version: 1 })
console.log(codec.decode(codec.encode({ count: 2 })))`
    },
    defineProtobufCodec: {
      options: 'IProtobufCodecOptions',
      role: 'factory',
      purpose: t(
        'Creates a frozen Buf Protobuf codec from a generated message descriptor. Codec version, application schema identity and schema version are distinct; the schema metadata is copied and frozen at construction.',
        '根据生成的 `Buf` 消息描述符创建冻结协议缓冲区编解码器；编解码器版本、应用模式标识和模式版本相互独立，模式元数据在构造时复制并冻结。'
      ),
      params: {
        options: t(
          'Required options with positive safe codec version, application-owned schema { id, version }, and generated Buf DescMessage binding; see IProtobufCodecOptions.',
          '必填选项，包含正安全整数编解码器版本、应用维护的模式标识与版本，以及生成的 `Buf` `DescMessage` 绑定，见 `IProtobufCodecOptions`。'
        )
      },
      returns: t(
        'ICodec of the generated MessageShape and Uint8Array with a frozen schema snapshot. Invalid metadata uses INVALID_OPTION; binary failures use ENCODE_FAILED or DECODE_FAILED and retain cause.',
        '返回生成的 `MessageShape` 与 `Uint8Array` 之间的 `ICodec`，附冻结模式快照；非法元数据使用 `INVALID_OPTION`，字节编解码失败使用 `ENCODE_FAILED` 或 `DECODE_FAILED` 并保留原因。'
      ),
      example: `import { defineProtobufCodec } from '@migaia/serialize/codecs/protobuf'
import { FileDescriptorProtoSchema } from '@bufbuild/protobuf/wkt'
import { create } from '@bufbuild/protobuf'
const codec = defineProtobufCodec({ version: 1, schema: { id: 'file-descriptor', version: 1 }, binding: FileDescriptorProtoSchema })
console.log(codec.decode(codec.encode(create(FileDescriptorProtoSchema, { name: 'demo.proto' }))))`
    },
    identityCodec: {
      role: 'constant',
      purpose: t(
        'Frozen version-one identity codec for carriers that preserve values themselves. Both encode(value) and decode(value) synchronously return exactly that value, including object identity; id is identity and encodedType is unknown.',
        '冻结的第一版恒等编解码器，用于自行保留值的载体；`encode(value)` 和 `decode(value)` 均同步原样返回输入，保留对象身份，标识为 `identity`，编码类型为 `unknown`。'
      ),
      example: `import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
const value = { count: 2 }
console.log(identityCodec.decode(identityCodec.encode(value)) === value)`
    },
    assertSerializeType: {
      role: 'operation',
      purpose: t(
        'Validates a plugin format token before it can enter envelope headers or HTML attributes. Tokens contain one through sixty-four ASCII letters, digits, dots, underscores or hyphens, and start with a letter or digit.',
        '校验进入封装头或 `HTML` 属性的插件格式令牌；长度为一至六十四个 `ASCII` 字母、数字、点、下划线或连字符，首字符必须为字母或数字。'
      ),
      params: {
        type: t(
          'Format tag chosen by a plugin author or read from a stored envelope.',
          '由插件作者选定或从存档封装头读取的格式标签。'
        )
      },
      returns: t(
        'Returns normally for a valid token; invalid tokens throw native RangeError with INVALID_OPTION.',
        '合法令牌正常返回，非法令牌抛带 `INVALID_OPTION` 的原生 `RangeError`。'
      ),
      example: `import { assertSerializeType } from '@migaia/serialize/core'
assertSerializeType('json-v2')`
    },
    isChunkShape: {
      role: 'operation',
      purpose: t(
        'Checks only for a two-element array with a string first element, distinguishing a chunk candidate from an array of chunks. It does not validate the tag or payload; registry operations perform full validation.',
        '仅检查二元素数组且首项为字符串，用于区分分块候选值和分块数组；不会校验标签或载荷，完整校验由注册表操作负责。'
      ),
      params: {
        value: t(
          'Unknown parser output to distinguish from a collection of output chunks.',
          '需要与分块集合区分的未知解析器输出。'
        )
      },
      returns: t(
        'Narrows to `readonly [string, unknown]`, not `ISerializeChunk`; use `validateSerializeChunk` to validate the kind and payload.',
        '只收窄为 `readonly [string, unknown]`，并非 `ISerializeChunk`；种类与载荷须交给 `validateSerializeChunk` 校验。'
      ),
      example: `import { isChunkShape } from '@migaia/serialize/core'
const candidate: unknown = ['text', 'hello']
if (isChunkShape(candidate)) console.log(candidate[0], candidate[1])`
    },
    bytesToBase64: {
      role: 'operation',
      purpose: t(
        'Encodes Uint8Array bytes as canonical padded RFC 4648 Base64 using runtime-neutral shared byte utilities, without host btoa or atob.',
        '使用运行时中立的共享字节工具，把 `Uint8Array` 编码为带规范填充的 `RFC 4648` `Base64`，不依赖宿主专用编码函数。'
      ),
      params: {
        bytes: t(
          'Caller-owned bytes to encode; the operation does not mutate their storage.',
          '调用者持有的待编码字节，不会修改其存储内容。'
        )
      },
      returns: t(
        'One padded Base64 string; empty bytes produce an empty string.',
        '返回一个带填充的 `Base64` 字符串，空字节数组返回空字符串。'
      ),
      example: `import { bytesToBase64, base64ToBytes } from '@migaia/serialize/core'
console.log(base64ToBytes(bytesToBase64(new Uint8Array([1, 2]))))`
    },
    base64ToBytes: {
      role: 'operation',
      purpose: t(
        'Decodes canonical padded RFC 4648 Base64. Invalid spelling rejects at the serialize boundary as a native coded TypeError; the original shared decoder failure is retained on `cause`.',
        '解码带规范填充的 `RFC 4648` `Base64`；非法拼写在序列化边界变为带码原生 `TypeError`，共享底层解码失败保存在 `cause`。'
      ),
      params: {
        text: t(
          'Canonical Base64 text received from storage or produced by bytesToBase64; the empty string represents empty bytes.',
          '取自存储或由 `bytesToBase64` 产生的规范 `Base64` 文本，空字符串代表空字节。'
        )
      },
      returns: t(
        'New Uint8Array bytes, or TypeError with INVALID_OPTION for invalid Base64 input.',
        '返回新 `Uint8Array`，非法 `Base64` 输入抛带 `INVALID_OPTION` 的 `TypeError`。'
      ),
      example: `import { base64ToBytes } from '@migaia/serialize/core'
console.log(base64ToBytes('AQI='))`
    },
    streamBase64Chunks: {
      role: 'operation',
      purpose: t(
        'Synchronously yields Base64 text pieces for a streaming sink without allocating one full encoded string. Input pieces use a three-byte-aligned limit of 32763 bytes so concatenation preserves canonical padding.',
        '同步向流式接收端产出 `Base64` 文本片段，不分配完整编码字符串；输入片段上限为按三字节对齐的 `32763` 字节，拼接后保持规范填充。'
      ),
      params: {
        bytes: t(
          'Caller-owned byte array to encode progressively without mutation.',
          '调用者持有、需要渐进编码的字节数组，不会被修改。'
        )
      },
      returns: t(
        'A synchronous Generator<string>; concatenating its pieces produces the same wire text as bytesToBase64.',
        '返回同步 `Generator<string>`，其片段拼接后与一次性 `Base64` 编码的线文本一致。'
      ),
      example: `import { streamBase64Chunks } from '@migaia/serialize/core'
for (const text of streamBase64Chunks(new Uint8Array([1, 2, 3]))) console.log(text)`
    },
    collectStream: {
      role: 'operation',
      purpose: t(
        'Collects a sync or async stream of wire chunks into one in-memory result. Text-only streams concatenate; assembling multiple chunks containing bytes currently requires an explicit encoder, even when no text occurs. Value chunks reject, and source cleanup failures remain observable.',
        '把同步或异步线格式分块流收集为内存中的完整结果；纯文本直接拼接，含字节的多分块拼装当前要求显式编码器，即使没有文本；值分块拒绝，源清理失败仍可追踪。'
      ),
      params: {
        chunks: t(
          'Iterable of text or byte chunks, from a parser, encodeStream or a carrier; value chunks are not accepted.',
          '来自解析器、`encodeStream` 或载体的文本或字节分块迭代源，不接受值分块。'
        ),
        encoder: t(
          'Optional ITextEncoder from a host TextEncoder or injected implementation. No default; required for any multi-chunk assembly containing bytes, even an all-byte stream.',
          '可选 `ITextEncoder`，可由宿主 `TextEncoder` 或注入实现提供；没有默认值，含字节的多分块拼装始终需要，即使全为字节分块。'
        )
      },
      options: 'ICollectStreamOptions',
      returns: t(
        'Promise of a text or byte chunk. Empty streams follow the empty option; invalid chunks use INVALID_CHUNK, source failures ENCODE_FAILED, cancellation ABORTED and malformed options INVALID_OPTION; missing encoder for multi-chunk byte assembly uses ENV_UNSUPPORTED.',
        '返回文本或字节分块的承诺；空流按空流选项处理，坏分块使用 `INVALID_CHUNK`，源失败使用 `ENCODE_FAILED`，取消使用 `ABORTED`，非法选项使用 `INVALID_OPTION`，含字节的多分块拼装缺少编码器使用 `ENV_UNSUPPORTED`。'
      ),
      example: `import { collectStream } from '@migaia/serialize/core'
console.log(await collectStream([['text', 'hello'], ['text', ' world']]))`
    },
    encodeStream: {
      role: 'operation',
      purpose: t(
        'Adaptively slices an application array, encodes each slice through a registry and yields ordered chunks with bounded in-flight encoding. Pair it with a registry created by `createSerializeRegistry` and an installed parser such as `jsonPlugin`; the example consumes each chunk directly with `chunkToText`. A receiver can instead use `decodeStream` to restore separate arrays. Concatenating JSON slice texts does not make one JSON document. The runnable case imports `@migaia/utils/scheduler` directly: install `@migaia/utils` as a direct dependency alongside this package.',
        '自适应切分应用数组，经注册表编码各片并按序产出分块，限制在途编码数量。搭配 `createSerializeRegistry` 创建并装好解析器的注册表使用，示例以 `jsonPlugin` 提供 JSON 解析器，再用 `chunkToText` 直接消费输出。需要还原切片数组时，可选择 `decodeStream` 作为消费方；拼接 JSON 切片文本并不构成一个 JSON 文档。可运行场景直接导入 `@migaia/utils/scheduler`，须将 `@migaia/utils` 与本包一同安装为直接依赖。'
      ),
      params: {
        registry: t(
          'ISerializeRegistry created by createSerializeRegistry with the desired parser plugins installed.',
          '通过 `createSerializeRegistry` 创建并安装所需解析插件的 `ISerializeRegistry`。'
        ),
        items: t(
          'Caller-owned array to divide into slices; each slice is encoded as an independent array value.',
          '调用者提供的待切片数组，每片作为独立数组值编码。'
        )
      },
      options: 'IEncodeStreamOptions',
      returns: t(
        'AsyncGenerator<ISerializeChunk> in original slice order. Breaking iteration cancels owned work; parser failures retain slice position and cause, while option admission uses INVALID_OPTION.',
        '按原切片顺序返回 `AsyncGenerator<ISerializeChunk>`；提前结束迭代会取消所属工作，解析失败保留切片位置及原因，选项接纳失败使用 `INVALID_OPTION`。'
      ),
      exampleIntro: serializeCases.encodeStream![0]!.problem,
      example: serializeCases.encodeStream![0]!.example,
      exampleResult: serializeCases.encodeStream![0]!.result,
      cases: serializeCases.encodeStream
    },
    decodeStream: {
      optionCases: serializeOptionCases.decodeStream!,
      optionDocs: {
        type: {
          summary: t(
            'Registered format selected from the input envelope or registry types list.',
            '从输入封装头或注册表格式列表选择的已注册格式。'
          ),
          default: t(
            'The registry primaryType from its first registered plugin.',
            '默认注册表首个注册插件的格式。'
          )
        },
        context: {
          summary: t(
            'Caller-owned label identifying the logical decode stream in diagnostics.',
            '调用者拥有、在诊断中标识逻辑解码流的标签。'
          ),
          default: t('The literal stream label is used.', '默认使用字面量 `stream` 标签。')
        },
        signal: frameMembers.signal!
      },
      role: 'operation',
      purpose: t(
        'Decodes each input chunk independently through a registry without collecting the stream. Pair with encodeStream when restoring arrays encoded in slices; it yields one decoded slice per chunk and does not merge arrays.',
        '逐个经注册表解码输入分块，不收集整个流；搭配 `encodeStream` 还原切片数组，每个分块产出一个解码切片，不合并数组。'
      ),
      params: {
        registry: t(
          'Registry created by createSerializeRegistry, with the parser matching the stored or transmitted format.',
          '由 `createSerializeRegistry` 创建、包含匹配存档或传输格式解析器的注册表。'
        ),
        chunks: t(
          'Sync or async iterable of independently encoded chunks, commonly produced by encodeStream.',
          '由调用者提供的独立编码分块同步或异步迭代源，通常由 `encodeStream` 产生。'
        ),
        options: t(
          'Optional fields: type from the envelope defaults to the registry primary type; context defaults to stream; signal from an abort controller defaults to absent.',
          '可选字段：取自封装头的 `type` 默认注册表首选格式，`context` 默认 `stream`，取自取消控制器的 `signal` 默认省略。'
        )
      },
      returns: t(
        'AsyncGenerator<unknown> yielding parser results in input order; cancellation and source or parser failures terminate iteration with coded errors and retained causes.',
        '按输入顺序产出解析结果的 `AsyncGenerator<unknown>`；取消、源失败或解析失败以带码错误终止迭代并保留原因。'
      ),
      example: streamExample
    },
    sliceByFrameBudget: {
      role: 'operation',
      purpose: t(
        'Yields array slices and measures consumer work between yield and resume to adjust the next slice size. It waits between slices using an injected scheduler or yield callback; a target duration is adaptive rather than preemptive.',
        '产出数组切片，通过产出至恢复之间的消费者耗时调整下一片大小；片间经注入调度器或让出回调等待，目标时长用于自适应而非抢占中断。'
      ),
      params: {
        items: t(
          'Caller-owned source array; each yielded slice is a shallow array copy with original item references.',
          '调用者提供的源数组，产出的每片是浅层数组副本，保留条目原始引用。'
        )
      },
      options: 'IFrameBudgetOptions',
      returns: t(
        'AsyncGenerator of readonly array slices. Invalid options throw INVALID_OPTION; an aborted signal throws ABORTED. Early return stops future slices.',
        '返回只读数组切片的 `AsyncGenerator`；非法选项使用 `INVALID_OPTION`，取消使用 `ABORTED`，提前结束会停止未来切片。'
      ),
      example: `import { sliceByFrameBudget } from '@migaia/serialize/core'
import { systemScheduler } from '@migaia/utils/scheduler'
for await (const rows of sliceByFrameBudget([1, 2, 3], { scheduler: systemScheduler })) console.log(rows)`
    },
    chunkToText: {
      role: 'operation',
      purpose: t(
        'Converts one text or byte chunk into text using an explicit decoder for bytes. A value chunk has no wire text representation and rejects; this helper does not run a format parser.',
        '把一个文本或字节分块转为文本，字节使用显式解码器；值分块没有线文本表示并被拒绝，此函数不运行格式解析器。'
      ),
      params: {
        chunk: t(
          'Wire chunk returned by registry encoding or read from a carrier.',
          '由注册表编码返回或从载体读取的线格式分块。'
        ),
        decoder: t(
          'Required ITextDecoder, commonly a new host TextDecoder; used only for byte chunks.',
          '必填 `ITextDecoder`，通常使用新建宿主 `TextDecoder`，仅字节分块需要实际解码。'
        )
      },
      returns: t(
        'Existing text or decoded bytes. Value chunks throw TypeError with INVALID_CHUNK; decoder failures receive `DECODE_FAILED` while retaining native identity where possible; wrappers keep the original on `cause`.',
        '返回原文本或解码后的字节文本；值分块抛带 `INVALID_CHUNK` 的 `TypeError`，解码器失败附 `DECODE_FAILED` 并尽量保留原生身份；需要包装时由 `cause` 保留原错。'
      ),
      example: `import { chunkToText } from '@migaia/serialize/registry'
console.log(chunkToText(['bytes', new Uint8Array([65])], new TextDecoder()))`
    },
    chunkToBytes: {
      role: 'operation',
      purpose: t(
        'Converts a text or byte chunk into bytes with an explicit encoder. Existing byte storage is copied, so the returned buffer is independently owned; value chunks reject.',
        '通过显式编码器把文本或字节分块转换为字节；已有字节存储会被复制，返回缓冲区独立拥有，值分块被拒绝。'
      ),
      params: {
        chunk: t(
          'Wire chunk returned by registry encoding or read from a carrier.',
          '由注册表编码返回或从载体读取的线格式分块。'
        ),
        encoder: t(
          'Required ITextEncoder, commonly a new host TextEncoder; used only for text chunks.',
          '必填 `ITextEncoder`，通常使用新建宿主 `TextEncoder`，仅文本分块需要实际编码。'
        )
      },
      returns: t(
        'New bytes for text or a slice of existing byte storage. Value chunks throw TypeError with INVALID_CHUNK; encoder failures receive `ENCODE_FAILED` while retaining native identity where possible; wrappers keep the original on `cause`.',
        '文本返回新字节，字节载荷返回存储副本；值分块抛带 `INVALID_CHUNK` 的 `TypeError`，编码器失败附 `ENCODE_FAILED` 并尽量保留原生身份；需要包装时由 `cause` 保留原错。'
      ),
      example: `import { chunkToBytes } from '@migaia/serialize/registry'
console.log(chunkToBytes(['text', 'hello'], new TextEncoder()))`
    },
    createSerializeRegistry: {
      role: 'factory',
      purpose: t(
        'Creates a registry owning a nonempty plugin set and parser cleanup. The first plugin selects default writes and reads; types and methods are captured at construction and duplicate types reject. Chunks carry only kind and payload, so older formats must be selected using their separately stored `type`. The migration case uses JSON parser options `replacer` and `reviver`: both receive the current property key (including an empty root key) and value, synchronously return its replacement, and default to `undefined`. The old reader maps numeric theme 0 to light through its reviver; `space` defaults to undefined (compact output), and `decoder` defaults to a host TextDecoder when bytes are decoded. Returning undefined from the replacer omits an object property. These plugin options are separate from registry options below.',
        '创建持有非空插件集合及解析器清理职责的注册表。首个插件决定默认读写，构造时捕获类型和方法，拒绝重复类型。片段只携带种类和载荷，旧格式必须通过另存的 `type` 选择。迁移场景使用 JSON 解析器的 `replacer`、`reviver` 选项：两者接收当前属性名（含空串根名）与值，同步返回替代值，默认 `undefined`，旧读取器通过还原器将数字主题 0 映射为 light；`space` 默认 `undefined`，即紧凑文本；`decoder` 默认在解码字节时使用宿主 TextDecoder。替换器返回 `undefined` 会省略对象属性。这些插件选项与下面的注册表选项分开。'
      ),
      params: {
        plugins: t(
          'Required nonempty ordered `ISerializePlugin` array. Every descriptor requires unique `type` matching `/^[a-z0-9][a-z0-9._-]{0,63}$/i` and `parser`. A parser requires diagnostic `name`, callable `encode(value, context)` and `decode(chunk, context)`; optional zero-argument `dispose()` defaults to absent. Context has required `signal` and string `context`. Encoding returns a chunk, Promise of one, or sync/async iterable of chunks; decoding returns a value or Promise. Chunk kinds are `["text", string]`, `["bytes", Uint8Array]` and `["value", unknown]`. There are no defaults for required fields. Shared parser objects are disposed once. The first type selects default writes and reads; persist the type separately when formats coexist.',
          '必填非空有序 `ISerializePlugin` 数组。每项须有唯一且匹配 `/^[a-z0-9][a-z0-9._-]{0,63}$/i` 的 `type`，以及 `parser`。解析器须有诊断名称 `name`、可调用 `encode(value, context)` 与 `decode(chunk, context)`，可选无参数 `dispose()` 默认省略。上下文含必填 `signal` 与字符串 `context`。编码返回片段、单片段 Promise 或同步及异步片段迭代源，解码返回值或其 Promise。片段只有 `["text", string]`、`["bytes", Uint8Array]`、`["value", unknown]` 三类，必填字段没有默认值，共享解析器对象只清理一次。首个类型决定默认读写，多格式共存时应另存类型标签。'
        )
      },
      options: 'ISerializeRegistryOptions',
      returns: t(
        'ISerializeRegistry with close and promise-idempotent dispose. Invalid lists or capabilities throw INVALID_OPTION; missing host encoding capabilities throw ENV_UNSUPPORTED. Construction validates before taking parser ownership.',
        '返回具有关闭及承诺幂等销毁能力的 `ISerializeRegistry`；非法列表或能力抛 `INVALID_OPTION`，缺少宿主编码能力抛 `ENV_UNSUPPORTED`，取得解析器所有权前完成构造校验。'
      ),
      exampleIntro: serializeCases.createSerializeRegistry![0]!.problem,
      example: serializeCases.createSerializeRegistry![0]!.example,
      exampleResult: serializeCases.createSerializeRegistry![0]!.result,
      cases: serializeCases.createSerializeRegistry
    },
    jsonParser: {
      role: 'factory',
      purpose: t(
        'Creates a native JSON parser. Encoding delegates to JSON.stringify, decoding parses text or bytes, and value chunks pass through unchanged. Standalone stringify failures receive `ENCODE_FAILED`; parse and decoder failures receive `DECODE_FAILED`. Annotatable native errors retain identity and type; wrappers retain the original cause. Missing byte decoding capability uses `ENV_UNSUPPORTED`.',
        '创建原生 `JSON` 解析器；编码调用 `JSON.stringify`，解码解析文本或字节，值分块原样通过；直接调用时，字符串化失败附 `ENCODE_FAILED`，解析与解码器失败附 `DECODE_FAILED`。可附码的原生错误保留身份与类型，需要包装时保留原始原因；缺少字节解码能力使用 `ENV_UNSUPPORTED`。'
      ),
      options: 'IJsonPluginOptions',
      returns: t(
        'ISerializeParser named json, without an owned disposer. Undefined stringify output throws TypeError with ENCODE_FAILED; byte decode without an injected or host decoder throws ENV_UNSUPPORTED.',
        '返回名称为 `json`、不持有清理函数的 `ISerializeParser`；字符串化结果为未定义时抛带 `ENCODE_FAILED` 的 `TypeError`，字节解码缺少注入或宿主解码器时抛 `ENV_UNSUPPORTED`。'
      ),
      example: parserExample
    },
    jsonPlugin: {
      role: 'enhancer',
      purpose: t(
        'Builds a JSON format registration descriptor containing a fresh jsonParser. Pair with createSerializeRegistry to make the json type available to its encode and decode operations; creating the descriptor alone does not install anything.',
        '构造包含新 `JSON` 解析器的格式注册描述；搭配 `createSerializeRegistry` 让注册表编解码操作支持 `json` 格式，单独创建描述不会安装能力。'
      ),
      options: 'IJsonPluginOptions',
      returns: t(
        'ISerializePlugin with type json and a native JSON parser. Its descriptor is passed to the registry constructor.',
        '返回格式标签为 `json`、包含原生 `JSON` 解析器的 `ISerializePlugin`，将其描述传给注册表构造函数。'
      ),
      example: registryExample
    },
    tagSerializeError: {
      role: 'operation',
      purpose: t(
        'Attaches immutable serialize source, semantic code and optional context to the original native error, retaining identity, stack and runtime type. Matching tags are idempotent; conflicting source or code delegates to utils and throws `ERROR_IDENTITY_CONFLICT`, retaining the original error on `cause`.',
        '把不可变序列化来源、语义码及可选上下文附到原生错误，保留身份、堆栈与运行时类型；相同标记幂等，来源或码冲突由工具包抛 `ERROR_IDENTITY_CONFLICT`，并在 `cause` 保留原始错误。'
      ),
      params: {
        error: t(
          'Caller-owned native Error instance whose identity and stack must remain unchanged.',
          '调用者持有、需要保留身份与堆栈的原生 `Error` 实例。'
        ),
        code: t(
          'Semantic code chosen from SerializeErrorCode for this failure boundary.',
          '从 `SerializeErrorCode` 选择、对应当前失败边界的语义错误码。'
        ),
        context: t(
          'Optional application label; defaults to absent. A matching already-tagged error gains context only when it has none.',
          '可选应用标签，默认省略；已带相同标记的错误仅在尚无上下文时新增标签。'
        )
      },
      returns: t(
        'The same error instance narrowed to ISerializeTaggedError; conflicting existing identity rejects rather than being overwritten.',
        '返回同一个错误实例并收窄为 `ISerializeTaggedError`，已有身份冲突会拒绝而非覆盖。'
      ),
      example: `import { tagSerializeError, SerializeErrorCode } from '@migaia/serialize/core'
const error = new RangeError('invalid size')
console.log(tagSerializeError(error, SerializeErrorCode.invalidOption) === error)`
    },
    createSerializeError: {
      optionCases: serializeErrorOptionCases('createSerializeError', true),
      optionDocs: {
        ...nativeErrorOptions,
        errors: {
          summary: t(
            'Secondary thrown values supplied after rollback; a nonempty list is copied and frozen without replacing cause.',
            '回滚后提供的次要抛出值，非空列表复制并冻结且不会替换原始原因。'
          ),
          default: t(
            'Omitted or empty lists produce no errors property.',
            '默认省略，空列表同样不产生错误列表属性。'
          )
        }
      },
      role: 'operation',
      purpose: t(
        'Creates a tagged native Error for construction or lifecycle failures. Optional cause retains the original thrown value; a nonempty errors list is copied and frozen without replacing cause.',
        '创建构造或生命周期失败使用的带码原生 `Error`；可选原因保留原始抛出值，非空错误列表复制并冻结且不会替换原因。'
      ),
      params: {
        code: t(
          'Semantic code from SerializeErrorCode chosen for the current failure.',
          '从 `SerializeErrorCode` 选择、符合当前失败语义的错误码。'
        ),
        message: t(
          'Caller-owned diagnostic message describing the concrete failed action.',
          '调用者维护、描述具体失败动作的诊断消息。'
        ),
        options: t(
          'Optional cause, context and errors; all default to absent. Cause is retained by identity, context is an application label, and nonempty errors becomes a frozen copied snapshot.',
          '可选 `cause`、`context`、`errors`，默认均省略；原因按身份保留，上下文为应用标签，非空错误列表成为复制后的冻结快照。'
        )
      },
      returns: t(
        'ISerializeLifecycleError retaining native Error behavior and optional cause/errors paths.',
        '返回保留原生 `Error` 行为及可选原因和错误列表路径的 `ISerializeLifecycleError`。'
      ),
      example: `import { createSerializeError, SerializeErrorCode } from '@migaia/serialize/core'
console.log(createSerializeError(SerializeErrorCode.registryDisposed, 'registry closed'))`
    },
    createSerializeTypeError: {
      optionCases: serializeErrorOptionCases('createSerializeTypeError', false),
      optionDocs: nativeErrorOptions,
      role: 'operation',
      purpose: t(
        'Creates a native TypeError tagged with serialize source, code and optional context, retaining a supplied original cause. Use for invalid capability or option shape without replacing native type semantics.',
        '创建带序列化来源、错误码及可选上下文的原生 `TypeError`，保留提供的原始原因；用于能力或选项形状非法，保留原生类型语义。'
      ),
      params: {
        code: t(
          'Semantic code selected from SerializeErrorCode for the invalid input.',
          '从 `SerializeErrorCode` 选择、对应非法输入的语义错误码。'
        ),
        message: t(
          'Caller-owned message describing the rejected type or option shape.',
          '由调用者维护、描述被拒绝类型或选项形状的消息。'
        ),
        options: t(
          'Optional original cause and application context; both default to absent.',
          '可选原始原因与应用上下文，默认均不设置。'
        )
      },
      returns: t(
        'ISerializeTypeError that remains instanceof TypeError and retains the original cause object.',
        '返回仍满足原生类型判断、并保留原始原因对象的 `ISerializeTypeError`。'
      ),
      example: errorExample
    },
    createSerializeRangeError: {
      optionCases: serializeErrorOptionCases('createSerializeRangeError', false),
      optionDocs: nativeErrorOptions,
      role: 'operation',
      purpose: t(
        'Creates a native RangeError tagged with serialize source, code and optional context, retaining a supplied cause. Use for invalid numeric ranges or registration domains while preserving native RangeError behavior.',
        '创建带序列化来源、错误码及可选上下文的原生 `RangeError` 并保留原因；用于数值范围或注册值域非法，保留原生范围错误行为。'
      ),
      params: {
        code: t(
          'Semantic code selected from SerializeErrorCode for the rejected range or domain.',
          '从 `SerializeErrorCode` 选择、对应被拒绝范围或值域的语义码。'
        ),
        message: t(
          'Caller-owned diagnostic describing the invalid range or registration value.',
          '由调用者维护、描述非法范围或注册值的诊断消息。'
        ),
        options: t(
          'Optional original cause and application context; both default to absent.',
          '可选原始原因与应用上下文，默认均不设置。'
        )
      },
      returns: t(
        'ISerializeRangeError that remains instanceof RangeError and retains native stack and cause behavior.',
        '返回保留原生范围错误类型、堆栈与原因行为的 `ISerializeRangeError`。'
      ),
      example: `import { createSerializeRangeError, SerializeErrorCode } from '@migaia/serialize/core'
console.log(createSerializeRangeError(SerializeErrorCode.invalidOption, 'invalid count') instanceof RangeError)`
    },
    SerializeCodecError: {
      role: 'error',
      purpose: t(
        'Native Error subclass carrying format, phase and stream position for encoding or decoding failures. Constructor details provide code, type, phase, chunkIndex and bytesConsumed; context and cause are optional and source defaults to @migaia/serialize.',
        '携带格式、阶段与流位置的编解码失败原生错误子类；构造细节提供错误码、格式、阶段、分块位置及已消费字节数，上下文和原因可选，来源默认 `@migaia/serialize`。'
      ),
      params: {
        message: t(
          'Caller-provided diagnostic message; native Error retains it alongside its own stack.',
          '调用者提供的诊断消息，由原生错误与其自身堆栈一起保留。'
        ),
        details: t(
          'Caller-supplied failure location: required semantic code, format type, encode/decode phase, zero-based chunkIndex and bytesConsumed; optional context and cause are omitted by default, while source defaults to @migaia/serialize and may identify a higher-level owner. cause preserves the exact original failure.',
          '调用者给出的失败定位，必需语义码、格式、编码或解码阶段、零起始分块位置及已消费字节数；上下文与原因默认省略，来源默认本序列化包且可覆盖为高层拥有者，原因保留精确原始失败。'
        )
      },
      returns: t(
        'New native SerializeCodecError instance with the supplied diagnostics and original cause; construction returns it without throwing or validating diagnostic values.',
        '返回携带所给诊断及原始原因的新原生错误子类实例，构造不主动抛出该返回值，也不校验诊断字段值。'
      ),
      example: `import { SerializeCodecError, SerializeErrorCode } from '@migaia/serialize/core'
console.log(new SerializeCodecError('decode failed', { code: SerializeErrorCode.decodeFailed, type: 'json', phase: 'decode', chunkIndex: 0, bytesConsumed: 0 }))`
    },
    SERIALIZE_SOURCE: {
      role: 'error',
      purpose: t(
        'Canonical @migaia/serialize error source marker. Compare it together with SerializeErrorCode when native error classes come from several packages.',
        '序列化包错误来源的规范标记；当原生错误可能来自多个包时，与 `SerializeErrorCode` 一起比较以确定失败归属。'
      ),
      example: `import { SERIALIZE_SOURCE, createSerializeError, SerializeErrorCode } from '@migaia/serialize/core'
console.log(createSerializeError(SerializeErrorCode.registryDisposed, 'closed').source === SERIALIZE_SOURCE)`
    },
    SERIALIZE_TYPE_PATTERN: {
      role: 'constant',
      purpose: t(
        'Canonical plugin type token pattern used before format tags enter headers or HTML. It admits one through sixty-four ASCII token characters and requires an alphanumeric first character.',
        '格式标签进入封装头或 `HTML` 前使用的规范插件类型模式；接受一至六十四个 `ASCII` 令牌字符，首字符必须为字母或数字。'
      ),
      example: `import { SERIALIZE_TYPE_PATTERN } from '@migaia/serialize/core'
console.log(SERIALIZE_TYPE_PATTERN.test('json-v2'))`
    },
    ...Object.fromEntries(
      Object.entries(enumDocs).map(([name, doc]) => [
        name,
        {
          role: name === 'SerializeErrorCode' ? ('error' as const) : ('constant' as const),
          purpose: doc.summary,
          example:
            name === 'CodecErrorText'
              ? `import { CodecErrorText } from '@migaia/serialize/codec'
console.log(CodecErrorText.invalidVersion)`
              : name === 'SerializeErrorCode'
                ? errorExample
                : `import { ${name} } from '@migaia/serialize'
console.log(${name})`
        }
      ])
    )
  },
  types: {
    ICodec: {
      summary: t(
        'Generic synchronous codec object containing format identity, explicit version, encoded representation and two callbacks. Format factories freeze the codec object; they do not freeze decoded application data.',
        '通用同步编解码器对象，包含格式身份、显式版本、编码表示与两个回调；格式工厂冻结编解码器对象，不冻结已解码应用数据。'
      ),
      scenarios: [
        t(
          'A transport selects admission and wire behavior from codec metadata while keeping application types generic.',
          '传输层依据编解码器元数据选择接纳与线格式行为，同时保留应用泛型。'
        )
      ],
      example: codecExample,
      members: codecMembers
    },
    ICodecValue: {
      summary: t(
        'Recursive portable value union: null, booleans, finite numbers, strings, dense arrays and ordinary or null-prototype records. Native bytes encode through the reserved portable bytes tag, not as a decoded native typed array.',
        '递归可移植值联合：空值、布尔值、有限数字、字符串、稠密数组及普通或空原型记录；原生字节通过保留字节标签编码，不以解码原生类型数组表示。'
      ),
      example: codecExample,
      members: {}
    },
    IPortableBinaryResult: {
      summary: t(
        'Synchronous binary policy result: inline base64url text, borrowed Uint8Array, or borrowed ArrayBuffer. Native storage requires the strategy nativeByteLength callback; ownership is not transferred by this type.',
        '同步二进制策略结果：内联无填充字节文本、借用 `Uint8Array` 或借用 `ArrayBuffer`；原生存储要求策略提供字节长度回调，此类型不转移所有权。'
      ),
      example: walkerExample,
      members: {}
    },
    IPortableWalkerStrategy: {
      summary: t(
        'Caller-owned synchronous traversal policy captured once by createPortableWalker. Hooks receive the current node and invocation context; callbacks must return synchronously, and the violation hook throws the caller-owned coded error with the original cause.',
        '由调用者拥有、被遍历器工厂一次捕获的同步遍历策略；回调接收当前节点与调用上下文，必须同步返回，违规回调抛出调用者拥有的带码错误并保留原始原因。'
      ),
      example: walkerExample,
      members: {
        maxDepth: {
          summary: t(
            'Maximum admitted traversal depth, where root depth defaults to zero. Finite limits must be nonnegative safe integers.',
            '允许的最大遍历深度，根默认深度为零，有限上限必须为非负安全整数。'
          ),
          default: t(
            'Infinity, so no strategy depth ceiling is imposed.',
            '默认 `Infinity`，不由策略施加深度上限。'
          )
        },
        scalar: {
          summary: t(
            'Synchronous hook receiving primitive candidate value and walker context. Return a primitive or { value, violation? }; a deferred violation is raised after projection, while context.reject fails immediately.',
            '接收标量候选值及遍历上下文的同步回调；返回标量或含值与可选违规原因的对象，延迟违规在投影后抛出，使用上下文拒绝方法可立即失败。'
          ),
          params: {
            value: t(
              'Primitive node supplied by traversal from the caller input graph.',
              '遍历器从调用者输入图读取的标量节点。'
            ),
            context: t(
              'Invocation tools: reject(reason, cause?), isAncestor(object), isUint8Array, bytesToBase64url and isCanonicalBase64url; these are synchronous and reject throws.',
              '本次调用工具包括拒绝、祖先判断、字节检测、字节转无填充文本及规范文本判断，均同步执行，拒绝方法抛错。'
            )
          },
          returns: t(
            'Projected scalar or deferred scalar result; a throw aborts the traversal.',
            '返回投影标量或延迟校验结果，抛错终止遍历。'
          ),
          example: walkerExample
        },
        record: {
          summary: t(
            'Synchronous hook receiving an object and context. Return undefined for array handling, or entries with optional output. A tag emits an inline bytes object instead of traversing entries; hasBinary marks an existing binary tag, and validate checks the completed record. Entry children are traversed by the walker; missing output validates without constructing a record.',
            '接收对象及上下文的同步回调；返回未定义进入数组处理，或返回条目及可选输出；标签字段会直接生成内联字节对象，二进制字段标记既有字节标签，校验回调检查完成后的记录；子值由遍历器递归，缺少输出时只校验不构造记录。'
          ),
          params: {
            value: t('Current object node supplied by traversal.', '由遍历器提供的当前对象节点。'),
            context: t(
              'Current invocation rejection, ancestor and binary helper tools.',
              '当前调用的拒绝、祖先判断与二进制辅助工具。'
            )
          },
          returns: t(
            'Record admission or undefined. Optional validate(output) synchronously returns a violation reason or undefined; any throw aborts traversal through policy handling.',
            '返回记录接纳描述或未定义；可选 `validate(output)` 同步返回违规原因或未定义，抛错按策略处理并终止遍历。'
          ),
          example: walkerExample
        },
        binary: {
          summary: t(
            'Synchronous hook receiving an object and context before record or array handling. Return inline text or native storage for an atomic binary node, or undefined for ordinary traversal.',
            '在记录或数组处理前接收对象及上下文的同步回调；返回内联文本或原生存储表示原子二进制节点，返回未定义则继续普通遍历。'
          ),
          params: {
            value: t(
              'Object candidate supplied by traversal before container admission.',
              '遍历器在容器接纳前提供的对象候选值。'
            ),
            context: t(
              'Current rejection, ancestor, byte detection and canonical base64url helper tools.',
              '当前拒绝、祖先判断、字节检测及规范无填充字节文本工具。'
            )
          },
          returns: t(
            'IPortableBinaryResult or undefined. Without nativeByteLength only inline strings are supported; a throw stops traversal.',
            '返回 `IPortableBinaryResult` 或未定义；未提供原生字节长度回调时仅支持内联字符串，抛错终止遍历。'
          ),
          example: walkerExample
        },
        nativeByteLength: {
          summary: t(
            'Synchronous hook receiving admitted Uint8Array or ArrayBuffer and returning its byte length through the owner intrinsic accessor. Required only for strategies returning native binary storage.',
            '同步接收已接纳的 `Uint8Array` 或 `ArrayBuffer`，通过所属内建访问器返回字节长度；仅返回原生二进制存储的策略需要提供。'
          ),
          params: {
            value: t(
              'Native binary storage returned by the same strategy binary callback.',
              '同一策略二进制回调返回的原生存储。'
            )
          },
          returns: t(
            'Native byte count used in byteUpperBound; a throw becomes a traversal policy failure.',
            '返回计入字节上界的原生字节数量，抛错成为遍历策略失败。'
          ),
          default: t(
            'Absent; the binary hook is then restricted to inline strings or undefined.',
            '默认省略，此时二进制回调仅允许内联字符串或未定义。'
          ),
          example: walkerExample
        },
        array: {
          summary: t(
            'Synchronous array hook receives value, visit(child) and context. Visit each child with the supplied callback; return the projected array or { value, length?, violation? }. It cannot be supplied with arrayValue.',
            '同步数组回调接收数组、子值访问函数及上下文；用给定函数访问每个子值，返回投影数组或含数组、可选长度及违规原因的对象，不能与原始数组回调同时提供。'
          ),
          params: {
            value: t('Input array node supplied by traversal.', '遍历器提供的输入数组节点。'),
            visit: t(
              'Synchronous child visitor owned by the walker; returns one projected child and propagates traversal failures.',
              '遍历器拥有的同步子值访问函数，返回一个投影子值并传播遍历失败。'
            ),
            context: t(
              'Current invocation rejection and binary helper tools.',
              '当前调用的拒绝与二进制辅助工具。'
            )
          },
          returns: t(
            'Projected array or array admission; thrown errors stop traversal.',
            '返回投影数组或数组接纳描述，抛错终止遍历。'
          ),
          default: t(
            'Uses value.map(visit), retaining native map, species and hole behavior.',
            '默认使用 `value.map(visit)`，保留原生映射、物种与空洞行为。'
          ),
          example: walkerExample
        },
        arrayValue: {
          summary: t(
            'Alternative synchronous raw array hook receiving value, owned visit, childDepth, ancestors, guard, bounds and context. Invoke visit(child, childDepth, ancestors, guard, bounds) for children; cannot coexist with array.',
            '替代式同步原始数组回调，接收数组、所属访问函数、子深度、祖先、守卫、上界开关及上下文；以同一组遍历参数访问子值，不能同时提供普通数组回调。'
          ),
          params: {
            value: t('Input array node from traversal.', '来自遍历器的输入数组节点。'),
            visit: t(
              'Owned synchronous visitor accepting child, depth, ancestors, guard and bounds and returning a projected child.',
              '所属同步访问函数，接收子值、深度、祖先、守卫与上界开关并返回投影子值。'
            ),
            childDepth: t(
              'Walker-computed depth for immediate array children.',
              '遍历器计算的直属数组子值深度。'
            ),
            ancestors: t(
              'Invocation-owned active ancestor set; pass it to the supplied visitor.',
              '本次调用拥有的活动祖先集合，传给所提供访问函数。'
            ),
            guard: t(
              'Optional caller-supplied native-binary rejection guard; defaults to absent.',
              '调用者提供的可选原生二进制拒绝守卫，默认省略。'
            ),
            bounds: t(
              'Whether this invocation collects byte metadata rather than value only.',
              '表示当前调用是否收集字节元数据，而非仅返回值。'
            ),
            context: t(
              'Invocation-owned rejection and binary helper tools.',
              '本次调用拥有的拒绝与二进制辅助工具。'
            )
          },
          returns: t(
            'The projected array value without an admission wrapper; errors propagate through policy handling.',
            '直接返回无接纳包装的数组投影值，错误经策略处理传播。'
          ),
          default: t(
            'Absent; ordinary array handling is used instead.',
            '默认省略，改用普通数组处理路径。'
          ),
          example: walkerExample
        },
        key: {
          summary: t(
            'Synchronous hook receiving each record key and context before writing its child. Return nothing; reject or throw to forbid a field name.',
            '写入记录子值前同步接收每个键与上下文；无需返回值，可拒绝或抛错以禁止某个字段名。'
          ),
          params: {
            key: t(
              'Record key yielded by the strategy entries iterable.',
              '由策略条目迭代源产生的记录键。'
            ),
            context: t(
              'Current invocation tools whose reject method throws a policy violation.',
              '当前调用工具，其拒绝方法抛出策略违规。'
            )
          },
          returns: t(
            'No result is used; normal return admits the key.',
            '不使用返回值，正常返回即接纳该键。'
          ),
          default: t(
            'No key policy; all keys supplied by record entries are admitted.',
            '默认不施加键策略，接纳记录条目提供的所有键。'
          ),
          example: walkerExample
        },
        write: {
          summary: t(
            'Synchronous hook receiving output record, admitted key and projected child. Write the field using strategy-owned prototype and property semantics; a throw stops traversal.',
            '同步接收输出记录、已接纳键及投影子值，按策略拥有的原型与属性语义写字段，抛错终止遍历。'
          ),
          params: {
            output: t(
              'Output record returned by the strategy record callback.',
              '由策略记录回调返回的输出记录。'
            ),
            key: t(
              'Admitted entry key from the record entries iterable.',
              '来自记录条目迭代源、已经接纳的键。'
            ),
            child: t('Child value already projected by the walker.', '已被遍历器投影的子值。')
          },
          returns: t(
            'No result is used; the output record is updated in place.',
            '不使用返回值，输出记录被原地更新。'
          ),
          default: t(
            'Defines an own enumerable writable configurable data property, including safe handling of __proto__.',
            '默认定义自有、可枚举、可写且可配置的数据属性，安全处理 `__proto__`。'
          ),
          example: walkerExample
        },
        finish: {
          summary: t(
            'Synchronous hook applied after each array, record or inline bytes-tag projection; primitive and native-binary nodes bypass it. Receives that node and its native-binary descendant flag; return the published node, or throw to stop.',
            '在每个数组、记录及内联字节标签投影后调用的同步回调，标量与原生二进制节点跳过；接收该节点及其原生二进制后代标记，返回发布节点或抛错终止。'
          ),
          params: {
            value: t(
              'Container or inline bytes-tag projection already produced for the current node.',
              '遍历器已为当前节点生成的容器或内联字节标签投影。'
            ),
            hasNativeBinary: t(
              'True when native binary storage occurs below this projected container node.',
              '当前投影容器节点下含原生二进制存储时为真。'
            )
          },
          returns: t(
            'Final caller-selected projection; identity finish retains the projected value.',
            '返回调用者选择的最终投影，恒等完成回调保留原投影。'
          ),
          default: t(
            'Identity callback returns the projected value unchanged.',
            '默认恒等回调，原样返回投影值。'
          ),
          example: walkerExample
        },
        violation: {
          summary: t(
            'Required synchronous failure hook receiving reason and optional original cause. Must throw the caller-owned coded native error; no recovery value is accepted.',
            '必填同步失败回调，接收原因标识及可选原始原因，必须抛出调用者拥有的带码原生错误，不接受恢复值。'
          ),
          params: {
            reason: t(
              'Walker-owned classification such as depth, cycle, access, scalar, prototype, binary, tag or sparse.',
              '遍历器提供的深度、环、访问、标量、原型、二进制、标签或稀疏数组等分类标识。'
            ),
            cause: t(
              'Original failure captured during traversal, absent when the violation has no underlying throw.',
              '遍历过程捕获的原始失败，无底层抛错的违规会省略。'
            )
          },
          returns: t(
            'Never returns: throws the chosen error, retaining the supplied cause where present.',
            '永不正常返回，应抛出选定错误并保留提供的原始原因。'
          ),
          example: walkerExample
        }
      }
    },
    IJsonCodecOptions: {
      optionCases: serializeOptionCases.IJsonCodecOptions!,
      summary: t(
        'Required native JSON codec options; the caller owns the explicit positive safe integer wire version.',
        '必填原生 `JSON` 编解码器选项，调用者拥有显式正安全整数线格式版本。'
      ),
      example: codecExample,
      members: { version: versionMember }
    },
    ICborCodecOptions: {
      optionCases: serializeOptionCases.ICborCodecOptions!,
      summary: t(
        'Required CBOR codec options containing the explicit wire-format version selected by its owner.',
        '必填 `CBOR` 编解码器选项，包含其拥有者选定的显式线格式版本。'
      ),
      example: `import { defineCBORCodec } from '@migaia/serialize/codecs/cbor'
const codec = defineCBORCodec({ version: 1 })
console.log(codec.version)`,
      members: { version: versionMember }
    },
    IMessagePackCodecOptions: {
      optionCases: serializeOptionCases.IMessagePackCodecOptions!,
      summary: t(
        'Required MessagePack codec options containing an explicit positive safe integer codec version.',
        '必填 `MessagePack` 编解码器选项，包含显式正安全整数编解码器版本。'
      ),
      example: `import { defineMessagePackCodec } from '@migaia/serialize/codecs/message-pack'
const codec = defineMessagePackCodec({ version: 1 })
console.log(codec.version)`,
      members: { version: versionMember }
    },
    IProtobufCodecOptions: {
      optionCases: serializeOptionCases.IProtobufCodecOptions!,
      example: `import { defineProtobufCodec } from '@migaia/serialize/codecs/protobuf'
import { FileDescriptorProtoSchema } from '@bufbuild/protobuf/wkt'
const codec = defineProtobufCodec({ version: 1, schema: { id: 'file-descriptor', version: 1 }, binding: FileDescriptorProtoSchema })
console.log(codec.schema)`,
      summary: t(
        'Construction options separating codec wire version, stable application schema metadata and executable generated Buf message binding.',
        '区分编解码器线格式版本、稳定应用模式元数据及可执行生成 `Buf` 消息绑定的构造选项。'
      ),
      members: {
        version: versionMember,
        schema: {
          summary: t(
            'Application-owned IProtobufSchema; construction snapshots and freezes id and version independently from the codec version.',
            '应用拥有的 `IProtobufSchema`，构造时独立于编解码器版本复制并冻结其标识与版本。'
          )
        },
        binding: {
          summary: t(
            'Generated Buf DescMessage descriptor imported from a generated module, with kind message and string typeName; callbacks are provided by @bufbuild/protobuf.',
            '从生成模块导入的 `Buf` `DescMessage` 描述符，种类为消息且含字符串类型名，执行能力由 `@bufbuild/protobuf` 提供。'
          )
        }
      }
    },
    IProtobufSchema: {
      example: `import { defineProtobufCodec } from '@migaia/serialize/codecs/protobuf'
import { FileDescriptorProtoSchema } from '@bufbuild/protobuf/wkt'
const codec = defineProtobufCodec({ version: 1, schema: { id: 'file-descriptor', version: 1 }, binding: FileDescriptorProtoSchema })
console.log(codec.schema.id, codec.schema.version)`,
      summary: t(
        'Application-owned schema identity, independent from codec id and codec version; Protobuf construction freezes a copied snapshot.',
        '由应用拥有、独立于编解码器标识和版本的模式身份，协议缓冲区构造过程冻结其复制快照。'
      ),
      members: {
        id: {
          summary: t(
            'Stable schema identifier chosen by the schema owner; lowercase letter first, followed by lowercase letters, digits, dots or hyphens.',
            '模式拥有者指定的稳定标识，首字符为小写字母，后续可为小写字母、数字、点或连字符。'
          )
        },
        version: {
          summary: t(
            'Schema owner selected positive safe integer version, independent from the codec factory version.',
            '模式拥有者选定的正安全整数版本，与编解码器工厂版本相互独立。'
          )
        }
      }
    },
    ISerializeChunk: {
      summary: t(
        'Readonly discriminated tuple: [text, string], [bytes, Uint8Array] or [value, unknown]. Tuple immutability does not freeze payloads; registry validation copies and freezes only the tuple container.',
        '只读标签元组，载荷分别为文本、`Uint8Array` 或任意值；元组只读不代表载荷冻结，注册表校验仅复制并冻结元组容器。'
      ),
      example: registryExample,
      members: {}
    },
    ISerializeOutput: {
      summary: t(
        'Parser encoding result union: one chunk, a promise of one chunk, a synchronous iterable or an asynchronous iterable of chunks. Registry encoding normalizes these forms and owns iterator cleanup.',
        '解析器编码结果联合：单分块、单分块承诺、同步或异步分块迭代源；注册表编码统一这些形式并拥有迭代器清理。'
      ),
      example: parserExample,
      members: {}
    },
    ISerializeContext: {
      summary: t(
        'Per-operation parser context issued by the registry, or explicitly supplied for direct parser calls. Contains a structural cancellation signal and an application diagnostic label.',
        '由注册表签发、或直接调用解析器时显式提供的单次操作上下文，包含结构化取消信号与应用诊断标签。'
      ),
      members: {
        signal: {
          summary: t(
            'Registry-composed IAbortSignal from caller cancellation and closing; direct parser callers supply their own controller signal.',
            '注册表由调用者取消及关闭组合的 `IAbortSignal`，直接解析器调用者需提供自己的控制器信号。'
          )
        },
        context: {
          summary: t(
            'Caller diagnostic label, defaulting to anonymous for registry operations and stream for streaming operations.',
            '调用者诊断标签，注册表操作默认使用 `anonymous`，流操作默认使用 `stream`。'
          )
        }
      },
      example: parserExample
    },
    ISerializeParser: {
      summary: t(
        'Parser object owned by a registry after successful construction, or directly by its caller. Methods may be synchronous; the registry awaits asynchronous results and invokes a shared parser disposer once.',
        '构造成功后归注册表拥有，或由直接调用者拥有的解析器对象；方法可同步，注册表等待异步结果，共享解析器清理函数仅调用一次。'
      ),
      scenarios: [
        t(
          'Implement a format plugin that can encode one value into chunks and release worker or Wasm resources.',
          '实现将单个值编码为分块、并可释放工作线程或模块资源的格式插件。'
        )
      ],
      example: parserExample,
      members: {
        name: {
          summary: t(
            'Parser diagnostic name provided by its author; registration type is separately stored on ISerializePlugin.',
            '解析器作者提供的诊断名称，注册格式标签另存于 `ISerializePlugin`。'
          )
        },
        encode: {
          summary: t(
            'Parser-owned encoding callback, receiving value and registry-issued context. Throwing or rejecting becomes ENCODE_FAILED when invoked through a registry.',
            '解析器拥有的编码回调，接收值及注册表签发上下文，经注册表调用时抛错或拒绝会成为 `ENCODE_FAILED`。'
          ),
          params: {
            value: t(
              'Application input supplied by the registry encode caller.',
              '注册表编码调用者提供的应用输入。'
            ),
            context: t(
              'Operation-owned ISerializeContext with composed signal and caller label.',
              '操作拥有的 `ISerializeContext`，含组合信号及调用者标签。'
            )
          },
          returns: t(
            'ISerializeOutput as one chunk, promise or iterable; no chunks cause registry ENCODE_FAILED and malformed chunks cause INVALID_CHUNK.',
            '返回单分块、承诺或迭代源形式的 `ISerializeOutput`，无分块导致注册表 `ENCODE_FAILED`，坏分块导致 `INVALID_CHUNK`。'
          ),
          example: parserExample
        },
        decode: {
          summary: t(
            'Parser-owned decoding callback receiving one chunk and operation context. Registry callers receive wrapped DECODE_FAILED on parser throw or rejection.',
            '解析器拥有的解码回调，接收单分块与操作上下文；经注册表调用时解析器抛错或拒绝被包装为 `DECODE_FAILED`。'
          ),
          params: {
            chunk: t(
              'Validated input chunk supplied by the registry, or caller-owned chunk for direct calls.',
              '注册表提供的已校验输入分块，直接调用时由调用者自行提供。'
            ),
            context: t(
              'Operation-owned ISerializeContext with signal and diagnostic label.',
              '操作拥有、包含信号与诊断标签的 `ISerializeContext`。'
            )
          },
          returns: t(
            'A decoded value or Promise of that value; the selected parser defines its application shape.',
            '返回解码值或该值的承诺，应用形状由所选解析器定义。'
          ),
          example: parserExample
        },
        dispose: {
          summary: t(
            'Optional parser-owned cleanup callback with no arguments, invoked once per shared parser during registry disposal. Releases resources such as workers or Wasm handles.',
            '可选解析器清理回调，无参数，注册表销毁时每个共享解析器仅调用一次，用于释放工作线程或模块句柄等资源。'
          ),
          returns: t(
            'Nothing or Promise<void>; async release is awaited and failures follow the registry cleanup policy.',
            '返回空值或 `Promise<void>`，异步释放会被等待，失败按注册表清理策略处理。'
          ),
          default: t(
            'Absent; the registry has no parser-specific release work.',
            '默认省略，注册表没有解析器专属释放动作。'
          ),
          example: parserExample
        }
      }
    },
    ISerializePlugin: {
      summary: t(
        'Format registration descriptor pairing an envelope type token with an ISerializeParser. Pair with createSerializeRegistry to install it; the first descriptor selects the default format.',
        '把封装格式标签与 `ISerializeParser` 关联的注册描述；搭配 `createSerializeRegistry` 安装，首个描述决定默认格式。'
      ),
      scenarios: [
        t(
          'Keep old parsers registered for reads while writing with a new first format.',
          '保留旧解析器读取历史数据，同时使用首位新格式写入。'
        )
      ],
      example: registryExample,
      members: {
        type: {
          summary: t(
            'Format tag chosen by the plugin author and written by consumers into envelopes; unique in its registry and checked by assertSerializeType.',
            '插件作者选择、由消费者写入封装的格式标签，在注册表内唯一并由类型令牌校验函数检查。'
          )
        },
        parser: {
          summary: t(
            'Parser instance transferred to registry lifecycle ownership after all registration validation succeeds.',
            '全部注册校验成功后，生命周期所有权交给注册表的解析器实例。'
          )
        }
      }
    },
    ISerializeRegistry: {
      summary: t(
        'Registry instance returned by createSerializeRegistry, owning parser admission, asynchronous operation tracking and two-phase shutdown. Close cancels admission; dispose drains then releases resources with stable promise identity.',
        '注册表工厂返回的实例，拥有解析器接纳、异步操作追踪及两阶段关闭；关闭停止接收，销毁先排空后释放资源并保持承诺身份稳定。'
      ),
      scenarios: [
        t(
          'Persist data with format metadata and retain older parsers for migration reads.',
          '携带格式元数据持久化数据，并保留旧解析器用于迁移读取。'
        )
      ],
      example: registryExample,
      members: registryMembers
    },
    IFrameBudgetOptions: {
      optionCases: serializeOptionCases.IFrameBudgetOptions!,
      example: `import { sliceByFrameBudget } from '@migaia/serialize/core'
import { systemScheduler } from '@migaia/utils/scheduler'
for await (const rows of sliceByFrameBudget([1, 2], { scheduler: systemScheduler, targetMs: 8 })) console.log(rows)`,
      summary: t(
        'Adaptive slice settings captured once before stream work. A scheduler is required; all item counts are positive safe integers and targetMs is a finite positive duration.',
        '流工作前一次捕获的自适应切片设置，必须提供调度器；所有条目数为正安全整数，目标毫秒数为有限正时长。'
      ),
      members: frameMembers
    },
    IEncodeStreamOptions: {
      optionCases: serializeOptionCases.IEncodeStreamOptions!,
      example: streamExample,
      summary: t(
        'Frame-budget options plus parser selection, stream context and encoding backpressure. Each slice is encoded independently and output order matches source slice order.',
        '在帧预算上增加解析器选择、流上下文及编码背压；各片独立编码，输出顺序与源切片顺序一致。'
      ),
      members: {
        ...frameMembers,
        yieldTo: {
          ...frameMembers.yieldTo!,
          example: serializeOptionCases.IEncodeStreamOptions![1]!.example
        },
        type: {
          summary: t(
            'Registered format tag selected from registry.types or a stored envelope.',
            '从注册表格式列表或存档封装头选择的已注册格式标签。'
          ),
          default: t(
            'The registry primaryType from its first registered plugin.',
            '默认注册表首个插件提供的 `primaryType`。'
          )
        },
        context: {
          summary: t(
            'Caller diagnostic label identifying the logical stream in errors.',
            '由调用者提供、在错误中定位逻辑数据流的诊断标签。'
          ),
          default: t(
            'The literal `stream` label is used when omitted.',
            '默认使用字面量 `stream` 作为标签。'
          )
        },
        maxInFlight: {
          summary: t(
            'Positive safe integer limit on concurrent slice encoding promises; higher values overlap work while retaining more slices.',
            '并发切片编码承诺数量的正安全整数上限，较大值可重叠工作但保留更多切片。'
          ),
          default: t(
            '`1`, waiting for one encoded slice before admitting the next.',
            '默认 `1`，等待一个切片编码完成后再接收下一片。'
          )
        }
      }
    },
    ICollectStreamOptions: {
      optionCases: serializeOptionCases.ICollectStreamOptions!,
      example: `import { collectStream } from '@migaia/serialize/core'
console.log(await collectStream([], undefined, { empty: 'text', context: 'export' }))`,
      summary: t(
        'Collector-specific cancellation, empty-stream policy and diagnostics; options are captured before obtaining the source iterator.',
        '收集器专属的取消、空流策略与诊断选项，在取得源迭代器前捕获。'
      ),
      members: {
        signal: frameMembers.signal!,
        context: {
          summary: t(
            'Caller label used in collector error context and position diagnostics.',
            '调用者提供、用于收集错误上下文与位置诊断的标签。'
          ),
          default: t(
            'The literal `stream` label is used when omitted.',
            '默认使用字面量 `stream` 作为标签。'
          )
        },
        empty: {
          whenToUse: t(
            'Choose text for optional exports and reject when an empty download is a failure. Omission selects text and returns an empty string chunk.',
            '可选导出选 text，空下载应视为失败时选 reject。省略时采用 text，返回空字符串分块。'
          ),
          example: serializeOptionCases.ICollectStreamOptions![0]!.example,
          summary: t(
            'Chooses whether collecting an empty input stream succeeds or rejects.',
            '选择收集空输入流时正常完成还是拒绝。'
          ),
          default: t(
            'text, returning an empty text chunk.',
            '默认 `text`，返回内容为空字符串的文本分块。'
          ),
          values: {
            text: t(
              'Return [text, empty string] when no chunks are produced.',
              '没有分块时返回内容为空字符串的文本分块。'
            ),
            reject: t(
              'Reject with ENCODE_FAILED when no chunks are produced.',
              '没有分块时以 `ENCODE_FAILED` 拒绝收集操作。'
            )
          }
        }
      }
    },
    IJsonPluginOptions: {
      optionCases: serializeOptionCases.IJsonPluginOptions!,
      example: parserExample,
      summary: t(
        'Native JSON parser callbacks, indentation and byte decoder; jsonParser and jsonPlugin consume the same fields without portable codec versioning.',
        '原生 `JSON` 解析回调、缩进及字节解码器选项，解析器与插件使用相同字段，不包含可移植编解码器版本。'
      ),
      members: jsonOptionMembers
    },
    ISerializeRegistryOptions: {
      optionCases: serializeOptionCases.ISerializeRegistryOptions!,
      example: registryExample,
      summary: t(
        'Construction-time capabilities and cleanup observers captured before parser ownership is acquired; invalid shapes use INVALID_OPTION.',
        '取得解析器所有权前捕获的构造期能力与清理观察回调，形状非法使用 `INVALID_OPTION`。'
      ),
      members: registryOptionMembers
    },
    ISerializeCleanupError: {
      example: `import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize'
const registry = createSerializeRegistry([jsonPlugin()], { cleanup: { policy: 'report', report: (d) => console.error(d.kind, d.source, d.error) } })
await registry.dispose()`,
      summary: t(
        'Registry-created cleanup diagnostic delivered to cleanup.report, containing the original cleanup failure without replacing it.',
        '由注册表构造并交给清理报告回调的诊断，包含原始清理失败而不替换它。'
      ),
      members: {
        kind: {
          summary: t(
            'Always cleanup-error, distinguishing disposer failure from drain deadline diagnostics.',
            '固定为 `cleanup-error`，区分清理函数失败与排空截止时间诊断。'
          ),
          values: { enum: 'SerializeCleanupKind' }
        },
        source: errorMembers.source!,
        error: {
          summary: t(
            'Original failure thrown or rejected by parser cleanup, potentially an aggregate retaining all cleanup failures.',
            '解析器清理抛出或拒绝的原始失败，可能为保留所有清理失败的聚合错误。'
          )
        }
      }
    },
    ISerializeTimeoutDiagnostic: {
      example: `import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize'
import { systemScheduler } from '@migaia/utils/scheduler'
const registry = createSerializeRegistry([jsonPlugin()], { onDrainTimeout: (d) => console.log(d.kind, d.source, d.deadlineAt, d.pendingCount) })
await registry.dispose({ deadlineAt: systemScheduler.now() })`,
      summary: t(
        'Registry-created drain-deadline observation; this is a diagnostic event and does not itself reject disposal or skip parser cleanup.',
        '注册表创建的排空截止时间观察事件，自身不会使销毁拒绝或跳过解析器清理。'
      ),
      members: {
        kind: {
          summary: t(
            'Always drain-timeout, indicating the draining boundary reached its deadline.',
            '固定为 `drain-timeout`，表示排空边界达到截止时间。'
          ),
          values: { enum: 'SerializeCleanupKind' }
        },
        source: errorMembers.source!,
        deadlineAt: {
          summary: t(
            'Absolute deadline in the registry construction scheduler clock, copied from dispose options.',
            '从销毁选项复制、位于注册表构造时调度器时钟域内的绝对截止时间。'
          ),
          default: t(
            'Optional structurally; current registry deadline notifications provide the admitted deadline.',
            '类型允许省略，当前注册表到期通知会提供已接纳截止时间。'
          )
        },
        pendingCount: {
          summary: t(
            'Snapshot count of pending parser tasks at the time of timeout observation, rather than a live counter.',
            '超时观察时的待完成解析任务数量快照，并非实时计数器。'
          ),
          default: t(
            'Optional structurally; current registry notifications provide the pending tracker size.',
            '类型允许省略，当前注册表通知会提供待完成追踪器数量。'
          )
        }
      }
    },
    ITextEncoder: {
      example: `const encoder = new TextEncoder()
console.log(encoder.encode('hello'))`,
      summary: t(
        'Structural text-to-byte capability accepted without importing DOM or a host class. Registry capture preserves its original receiver; implementation owns its text encoding and failure behavior.',
        '无需导入宿主类或文档对象模型的结构化文本转字节能力，注册表捕获时保留原始接收者，实现自行拥有编码与失败行为。'
      ),
      members: {
        encode: {
          summary: t(
            'Synchronously converts one input string to bytes; it must return Uint8Array and throws to signal failure.',
            '同步把一个输入字符串转换为字节，必须返回 `Uint8Array`，通过抛错表示失败。'
          ),
          params: {
            input: t(
              'Text supplied by chunk conversion or mixed-stream collection.',
              '由分块转换或混合流收集提供的文本。'
            )
          },
          returns: t(
            'Encoded Uint8Array. Registry collection wraps encoder failures and rejects nonbyte results.',
            '返回编码后的 `Uint8Array`，注册表收集会包装编码器失败并拒绝非字节结果。'
          ),
          example: `const encoder = new TextEncoder()
console.log(encoder.encode('hello'))`
        }
      }
    },
    ITextDecoder: {
      example: `const decoder = new TextDecoder()
console.log(decoder.decode(new Uint8Array([65])))`,
      summary: t(
        'Structural byte-to-text capability injected into chunk conversion, registry construction or JSON parser options without requiring a concrete host class.',
        '注入分块转换、注册表构造或 `JSON` 解析选项的结构化字节转文本能力，不要求具体宿主类。'
      ),
      members: {
        decode: {
          summary: t(
            'Synchronously decodes one Uint8Array to text; implementation-selected decoding errors throw to the caller.',
            '同步将一个 `Uint8Array` 解码为文本，实现选择的解码错误通过抛错传给调用者。'
          ),
          params: {
            input: t(
              'Byte payload from a chunk supplied by the caller or carrier.',
              '来自调用者或载体所提供分块的字节载荷。'
            )
          },
          returns: t(
            'Decoded string; direct chunk helpers propagate decoder exceptions unchanged.',
            '返回解码字符串，直接分块辅助函数原样传播解码器异常。'
          ),
          example: `const decoder = new TextDecoder()
console.log(decoder.decode(new Uint8Array([65])))`
        }
      }
    },
    ISerializeTaggedError: taggedType(
      t(
        'Intersection preserving the native Error subtype while adding immutable serialize source, semantic code and optional caller context.',
        '保留原生错误子类型，同时新增不可变序列化来源、语义错误码及可选调用者上下文的交叉类型。'
      )
    ),
    ISerializeTypeError: taggedType(
      t(
        'Tagged native TypeError returned by createSerializeTypeError, retaining instanceof behavior, original stack and optional cause.',
        '类型错误工厂返回的带码原生 `TypeError`，保留类型判断行为、原始堆栈及可选原因。'
      )
    ),
    ISerializeRangeError: taggedType(
      t(
        'Tagged native RangeError returned by createSerializeRangeError for invalid ranges or registration domains.',
        '范围错误工厂返回、用于非法范围或注册值域的带码原生 `RangeError`。'
      )
    ),
    ISerializeLifecycleError: {
      ...taggedType(
        t(
          'Tagged native Error for construction or lifecycle failures, with an optional frozen snapshot of secondary failures.',
          '用于构造或生命周期失败的带码原生 `Error`，可带次要失败的冻结快照。'
        )
      ),
      members: {
        ...errorMembers,
        errors: {
          summary: t(
            'Optional frozen copied snapshot of nonempty secondary failure input; does not replace the original cause.',
            '可选的非空次要失败输入冻结副本，不会替换原始原因。'
          ),
          default: t(
            'Absent for omitted or empty error lists.',
            '错误列表省略或为空时不设置此属性。'
          )
        }
      }
    },
    SerializeCodecError: {
      summary: t(
        'Native Error subclass created at codec or stream boundaries, carrying stable error identity and precise operation position. Original failure is retained through native cause when supplied.',
        '在编解码或流边界创建的原生错误子类，携带稳定错误身份与具体操作位置，提供原因时经原生原因属性保留原始失败。'
      ),
      scenarios: [
        t(
          'Report which format, phase and chunk failed without parsing diagnostic messages.',
          '无需解析诊断消息即可报告失败格式、阶段和分块位置。'
        )
      ],
      example: `import { SerializeCodecError, SerializeErrorCode } from '@migaia/serialize/core'
const error = new SerializeCodecError('decode failed', { code: SerializeErrorCode.decodeFailed, type: 'json', phase: 'decode', chunkIndex: 0, bytesConsumed: 0 })
console.log(error.source, error.code, error.type, error.phase, error.chunkIndex, error.bytesConsumed)`,
      members: {
        ...errorMembers,
        code: {
          summary: t(
            'Caller-selected generic semantic code, defaulting to the serialize code union; higher layers may use their own code union.',
            '调用者选择的泛型语义码，默认使用序列化码联合，高层包可使用其自身码联合。'
          )
        },
        type: {
          summary: t(
            'Format tag supplied by the failing operation, usually selected from registry registration or a stored envelope.',
            '失败操作提供的格式标签，通常从注册表注册或存档封装头选择。'
          )
        },
        phase: {
          summary: t(
            'Whether the recorded position belongs to encoding or decoding, from SerializePhase.',
            '记录位置所属编码或解码阶段，取自 `SerializePhase`。'
          ),
          values: { enum: 'SerializePhase' }
        },
        chunkIndex: {
          summary: t(
            'Zero-based chunk or slice index at the failing boundary, supplied by the operation that constructs the error.',
            '构造错误的操作提供的失败边界零起始分块或切片序号。'
          )
        },
        bytesConsumed: {
          summary: t(
            'Byte progress recorded by the failing boundary; text-only paths may record zero rather than an encoded byte estimate.',
            '失败边界记录的字节进度，纯文本路径可能记录零而非编码字节估算。'
          )
        }
      }
    },
    ISerializeErrorCode: {
      example: errorExample,
      summary: t(
        'Value union of SerializeErrorCode for package-boundary failure classification; codes remain stable independently from message text.',
        '用于包边界失败分类的 `SerializeErrorCode` 值联合，错误码独立于消息文本保持稳定。'
      ),
      members: {}
    },
    ISerializeChunkKind: {
      example: registryExample,
      summary: enumDocs.SerializeChunkKind.summary,
      members: {}
    },
    ISerializeCleanupKind: {
      example: registryExample,
      summary: enumDocs.SerializeCleanupKind.summary,
      members: {}
    },
    ISerializeCleanupPolicy: {
      example: registryExample,
      summary: enumDocs.SerializeCleanupPolicy.summary,
      members: {}
    },
    ISerializeOutputFormat: {
      example: `import { SerializeOutput } from '@migaia/serialize'
console.log(SerializeOutput.binary)`,
      summary: enumDocs.SerializeOutput.summary,
      members: {}
    },
    ISerializePhase: {
      example: errorExample,
      summary: enumDocs.SerializePhase.summary,
      members: {}
    },
    ISerializePluginType: {
      example: registryExample,
      summary: enumDocs.SerializePluginType.summary,
      members: {}
    },
    ISerializeTextFormat: {
      example: `import { emitOutput, SerializeTextFormat } from '@migaia/serialize'
console.log(emitOutput({ count: 2 }, SerializeTextFormat.yaml))`,
      summary: enumDocs.SerializeTextFormat.summary,
      members: {}
    }
  },
  enums: enumDocs,
  enhancers: {
    jsonPlugin: {
      kind: 'plugin',
      target: 'ISerializeRegistry',
      summary: t(
        'Adds the json format to an explicitly constructed registry. Existing encode and decode APIs gain native JSON handling; the plugin adds no new method names.',
        '把 `json` 格式加入显式构造的注册表，让已有编解码接口获得原生 `JSON` 处理能力，不新增方法名。'
      ),
      install: registryExample,
      grants: [],
      behaviors: [
        t(
          'When registered first, json becomes the registry primaryType. Text decoding uses JSON.parse; bytes use the plugin decoder, while value chunks bypass parsing.',
          '首位注册时 `json` 成为注册表首选格式；文本使用 `JSON` 解析，字节使用插件解码器，值分块跳过解析。'
        ),
        t(
          'Plugin replacer and reviver callbacks preserve native JSON semantics; parser throws are wrapped by registry operations with retained causes.',
          '插件替换与还原回调保留原生 `JSON` 语义，解析器抛错由注册表操作包装并保留原因。'
        )
      ],
      scenarios: [
        t(
          'Persist ordinary JSON data while supporting custom field omission or synchronous restoration.',
          '持久化普通 `JSON` 数据，同时支持字段省略或同步还原。'
        )
      ],
      example: registryExample
    }
  }
}
