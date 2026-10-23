import type { ICaseDoc, IText } from './contract.js'

/** Holds complete bilingual task explanations and runnable code. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Registry, portable codec, text output and independent slice tasks use public entries only. */
export const serializeCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createSerializeRegistry: [
    {
      title: t('Encode settings and read them back', '编码设置后再读回原值'),
      problem: t(
        'A settings screen needs a text representation for saving and the same decoding path when it opens again.\n\nScattering stringify and parse calls across callers couples them to one format and leaves format selection and parser cleanup without a single owner.\n\nRegister `jsonPlugin()` in a serialize registry. Its first plugin chooses default writes; `encode()` returns a tagged chunk and `decode()` reads it. Use `chunkToText()` when a text channel needs the payload, then dispose the registry.',
        '设置页面需要生成可保存的文本，再次打开时还要走同一条解码路径。\n\n把字符串化和解析散在调用方，会把业务绑定到一种格式，也没有统一的地方管理格式选择和解析器清理。\n\n把 `jsonPlugin()` 登记到序列化注册表，首个插件决定默认写入格式。`encode()` 返回带类型的片段，`decode()` 负责读回；文本通道用 `chunkToText()` 取得载荷，结束时释放注册表。'
      ),
      example: t(
        "import { createSerializeRegistry, jsonPlugin, chunkToText } from '@migaia/serialize'\n\nconst registry = createSerializeRegistry([jsonPlugin()])\nconst chunk = await registry.encode({ theme: 'dark' })\nconst restored = await registry.decode(chunk) as { theme: string }\nconsole.log('format:', registry.primaryType)\nconsole.log('text:', chunkToText(chunk, new TextDecoder()))\nconsole.log('theme:', restored.theme)\nawait registry.dispose()",
        "import { createSerializeRegistry, jsonPlugin, chunkToText } from '@migaia/serialize'\n\nconst registry = createSerializeRegistry([jsonPlugin()])\nconst chunk = await registry.encode({ theme: 'dark' })\nconst restored = await registry.decode(chunk) as { theme: string }\nconsole.log('格式:', registry.primaryType)\nconsole.log('文本:', chunkToText(chunk, new TextDecoder()))\nconsole.log('主题:', restored.theme)\nawait registry.dispose()"
      ),
      result: t(
        'Prints `format: json`, `text: {"theme":"dark"}`, then `theme: dark`.\n\nThe same registered parser handles encoding and decoding. A chunk is only `[kind, payload]`, not a stored envelope containing the format tag; keep `primaryType` beside persisted data when several formats coexist. The registry owns parser cleanup and must be disposed.',
        '依次输出 `格式: json`、`文本: {"theme":"dark"}`、`主题: dark`。\n\n同一个已登记解析器完成编码和解码。片段只是 `[kind, payload]`，不是保存格式标签的存储封套；多格式共存时，应把 `primaryType` 另存到数据旁。解析器清理由注册表持有，结束后必须释放。'
      )
    },
    {
      title: t(
        'Write a new format while retaining an explicit old reader',
        '默认写新格式，按已保存标签读旧格式'
      ),
      problem: t(
        'New settings should omit a local preview cache, but existing saved settings still use the old format tag and must remain readable.\n\nReplacing the only parser can strand old records. Guessing a format from `[kind, payload]` also fails because the chunk does not carry the application’s format tag.\n\nRegister the new parser first and keep the old parser under its saved tag. New writes use the first type by default; pass the stored `type` explicitly to `decode()` for old data. Both formats use JSON: the new writer omits `localCache`, while the old reader revives a stored numeric theme of 0 as `light`.',
        '新设置不应继续保存本地预览缓存，但已保存的设置仍带旧格式标签，必须可以读回。\n\n直接替换唯一解析器，可能让旧记录再也无法读取；根据 `[kind, payload]` 猜格式也不可靠，因为片段不包含应用的格式标签。\n\n把新解析器放在登记列表首位，并用旧标签保留旧解析器。新写入默认使用首个类型，读旧记录时把已保存的 `type` 显式传给 `decode()`。两版都使用 JSON，新写入器省略 `localCache`，旧读取器则把存档中的数字主题 0 还原成 `light`。'
      ),
      example: t(
        "import { createSerializeRegistry, jsonParser, chunkToText } from '@migaia/serialize'\n\nconst registry = createSerializeRegistry([\n  { type: 'json-v2', parser: jsonParser({ replacer: (key, value) => key === 'localCache' ? undefined : value }) },\n  { type: 'json-v1', parser: jsonParser({ reviver: (key, value) => key === 'theme' && value === 0 ? 'light' : value }) }\n])\nconst saved = { type: 'json-v1', chunk: ['text', '{\"theme\":0,\"localCache\":\"legacy\"}'] as const }\nconst next = await registry.encode({ theme: 'dark', localCache: 'preview' })\nconst previous = await registry.decode(saved.chunk, { type: saved.type }) as { theme: string; localCache: string }\nconsole.log('new format:', registry.primaryType)\nconsole.log('new text:', chunkToText(next, new TextDecoder()))\nconsole.log('old theme:', previous.theme)\nconsole.log('old cache:', previous.localCache)\nawait registry.dispose()",
        "import { createSerializeRegistry, jsonParser, chunkToText } from '@migaia/serialize'\n\nconst registry = createSerializeRegistry([\n  { type: 'json-v2', parser: jsonParser({ replacer: (key, value) => key === 'localCache' ? undefined : value }) },\n  { type: 'json-v1', parser: jsonParser({ reviver: (key, value) => key === 'theme' && value === 0 ? 'light' : value }) }\n])\nconst saved = { type: 'json-v1', chunk: ['text', '{\"theme\":0,\"localCache\":\"legacy\"}'] as const }\nconst next = await registry.encode({ theme: 'dark', localCache: 'preview' })\nconst previous = await registry.decode(saved.chunk, { type: saved.type }) as { theme: string; localCache: string }\nconsole.log('新格式:', registry.primaryType)\nconsole.log('新文本:', chunkToText(next, new TextDecoder()))\nconsole.log('旧主题:', previous.theme)\nconsole.log('旧缓存:', previous.localCache)\nawait registry.dispose()"
      ),
      result: t(
        'Prints `new format: json-v2`, `new text: {"theme":"dark"}`, `old theme: light`, then `old cache: legacy`.\n\nThe default writer changed without removing the old reader. Passing the saved old tag selects its reviver, which changes the stored 0 into `light`; using the new reader would leave 0 unchanged. Registered type strings are application envelope metadata; codec factory `version` fields are a separate contract. The JSON plugin follows native replacer/reviver behavior rather than the stricter portable codec profile.',
        '依次输出 `新格式: json-v2`、`新文本: {"theme":"dark"}`、`旧主题: light`、`旧缓存: legacy`。\n\n默认写入器改变了，旧读取器仍在。显式传入已保存的旧标签，会选到其还原器，把存档中的 0 变成 `light`；误用新读取器则仍会得到 0。登记类型字符串属于应用封套元数据，与 codec 工厂的 `version` 字段是两种契约。JSON 插件遵循原生替换器和还原器行为，不使用更严格的 portable codec 规则。'
      )
    }
  ],
  defineCollectionsJsonCodec: [
    {
      title: t('Preserve nested collections', '保留嵌套集合'),
      problem: t(
        'Persist Map and Set with the shared strict portable rules. The collection codec preserves insertion order and rejects invalid values instead of silently dropping them.',
        '使用同一套严格 portable 规则保存 Map 与 Set，保留插入顺序并拒绝非法值，避免静默丢失数据。'
      ),
      example: t(
        "import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'\nconst codec = defineCollectionsJsonCodec({ version: 1 })\nconst text = codec.encode(new Map([['roles', new Set(['read'])]]))\nconsole.log(text, codec.decode(text))",
        "import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'\nconst codec = defineCollectionsJsonCodec({ version: 1 })\nconst text = codec.encode(new Map([['roles', new Set(['read'])]]))\nconsole.log(text, codec.decode(text))"
      ),
      result: t(
        'The text uses $rpc map/set records; decode returns a Map containing a Set. Bytes stay reserved records. Old tuple formats remain ordinary arrays.',
        '文本使用 $rpc map/set 记录；解码返回包含 Set 的 Map。字节保留为记录，旧元组格式仍为普通数组。'
      )
    }
  ],
  defineJsonCodec: [
    {
      title: t(
        'Reject a nonfinite count instead of saving null',
        '拒绝非有限计数，避免悄悄存成 null'
      ),
      problem: t(
        'A measurement containing `NaN` is saved as `null`, and a later reader cannot distinguish invalid input from an intentionally empty value.\n\nNative JSON replaces nonfinite numbers with null. Checking only the TypeScript number type does not reject `NaN`, so the original value can be lost without a failure.\n\nCreate `defineJsonCodec({ version: 1 })` and encode through its portable profile, a restricted cross-format data domain. Finite numbers pass; nonfinite numbers fail with `INVALID_OPTION` instead of being silently replaced.',
        '包含 `NaN` 的计量结果被存成了 `null`，之后读取时无法区分输入无效与有意清空。\n\n原生 JSON 会把非有限数字替换为 null，TypeScript 的 number 类型本身又不会拒绝 `NaN`，因此原值可能在没有报错的情况下丢失。\n\n用 `defineJsonCodec({ version: 1 })` 创建 JSON codec，经由 portable 规则编码；portable 是供不同格式共同使用的受限数据域。有限数字可通过，非有限数字会以 `INVALID_OPTION` 失败，不会被悄悄替换。'
      ),
      example: t(
        "import { defineJsonCodec } from '@migaia/serialize/codecs/json'\n\nconst codec = defineJsonCodec({ version: 1 })\nconsole.log('finite:', codec.encode({ count: 2 }))\nconsole.log('native JSON:', JSON.stringify({ count: Number.NaN }))\ntry { codec.encode({ count: Number.NaN }) }\ncatch (error) { console.log('portable failure:', (error as Error & { code: string }).code) }",
        "import { defineJsonCodec } from '@migaia/serialize/codecs/json'\n\nconst codec = defineJsonCodec({ version: 1 })\nconsole.log('有限值:', codec.encode({ count: 2 }))\nconsole.log('原生 JSON:', JSON.stringify({ count: Number.NaN }))\ntry { codec.encode({ count: Number.NaN }) }\ncatch (error) { console.log('portable 拒绝:', (error as Error & { code: string }).code) }"
      ),
      result: t(
        'Prints `finite: {"count":2}`, `native JSON: {"count":null}`, then `portable failure: INVALID_OPTION`.\n\nThe codec rejects this lossy scalar conversion. Its required version is a positive safe integer and is metadata on the codec, not automatically embedded in the returned string. This strict profile differs from `jsonPlugin()`, which intentionally retains native JSON behavior.',
        '依次输出 `有限值: {"count":2}`、`原生 JSON: {"count":null}`、`portable 拒绝: INVALID_OPTION`。\n\ncodec 拒绝了这次会丢失标量含义的转换。必填版本为正安全整数，是 codec 自身的元数据，不会自动嵌入返回字符串。这套严格规则与有意保留原生 JSON 行为的 `jsonPlugin()` 不同。'
      )
    }
  ],
  emitOutput: [
    {
      title: t(
        'Export the same configuration in three text formats',
        '把同一份配置导出为三种文本格式'
      ),
      problem: t(
        'A configuration download needs JSON, YAML and TOML, but separate emitters accept different values and produce inconsistent representations of the same settings.\n\nHandwritten formatting mixes value validation with quoting and nested collection syntax. Adding a format can accidentally change which fields survive or how strings are escaped.\n\nPass the configuration to `emitOutput()` and select `SerializeTextFormat`. All formats share the same plain-data admission rules; each call projects the input before emitting its selected format. Omitting the format selects JSON.',
        '配置下载需要 JSON、YAML 和 TOML，分别拼接文本时，对输入值的接受规则不同，同一份设置可能得到不一致的内容。\n\n手写格式化会把值校验、引号转义和嵌套集合语法混在一起，增加格式时容易顺带改变保留哪些字段或怎样转义字符串。\n\n把配置交给 `emitOutput()`，用 `SerializeTextFormat` 选择格式。三种格式共用普通数据接纳规则，每次调用都会先对输入校验并投影，再输出所选格式；省略格式时使用 JSON。'
      ),
      example: t(
        "import { emitOutput, SerializeTextFormat } from '@migaia/serialize'\n\nconst settings = { theme: 'dark', retries: 2 }\nconsole.log('JSON:', emitOutput(settings))\nconsole.log('YAML:', emitOutput(settings, SerializeTextFormat.yaml))\nconsole.log('TOML:\\n' + emitOutput(settings, SerializeTextFormat.toml))",
        "import { emitOutput, SerializeTextFormat } from '@migaia/serialize'\n\nconst settings = { theme: 'dark', retries: 2 }\nconsole.log('JSON:', emitOutput(settings))\nconsole.log('YAML:', emitOutput(settings, SerializeTextFormat.yaml))\nconsole.log('TOML:\\n' + emitOutput(settings, SerializeTextFormat.toml))"
      ),
      result: t(
        'Prints `JSON: {"theme":"dark","retries":2}`, `YAML: {"theme": "dark", "retries": 2}`, then three lines: `TOML:`, `"theme" = "dark"`, `"retries" = 2`.\n\nAll three outputs retain the supplied fields, and YAML uses valid flow syntax. This is text emission, not a YAML/TOML parser. TOML requires a root record and rejects null; other formats also reject unsupported values rather than silently omitting them.',
        '依次输出 `JSON: {"theme":"dark","retries":2}`、`YAML: {"theme": "dark", "retries": 2}`，然后三行 `TOML:`、`"theme" = "dark"`、`"retries" = 2`。\n\n三种输出保留了传入字段，YAML 使用合法的流式集合语法。这是文本生成工具，不是 YAML 或 TOML 解析器。TOML 要求根值为记录并拒绝 null，其余格式也会拒绝不支持的值，不会悄悄省略。'
      )
    },
    {
      title: t('Reject an accessor without evaluating it', '拒绝访问器字段，不执行其读取代码'),
      problem: t(
        'A configuration object contains a getter that exposes data or performs work when serialization reads the property.\n\nOrdinary property access during copying or stringify executes that getter. Deleting the field only after it has been read cannot undo the work or the exposure.\n\nUse `emitOutput()` for a plain-data export boundary. It inspects own enumerable property descriptors first and rejects accessors before evaluating their getter; valid data is projected before text is produced.',
        '配置对象中出现了访问器属性，序列化读取它时可能暴露数据或执行额外工作。\n\n普通复制或字符串化中的属性读取会执行 getter；读完以后再删字段，已经无法撤销执行或暴露。\n\n需要普通数据导出边界时使用 `emitOutput()`。它先检查自有可枚举属性描述器，在执行 getter 前拒绝访问器，只有有效数据投影完成后才生成文本。'
      ),
      example: t(
        "import { emitOutput } from '@migaia/serialize'\n\nlet reads = 0\nconst settings = { get token() { reads += 1; return 'example-token' } }\ntry { emitOutput(settings) }\ncatch (error) { console.log('rejected:', error instanceof TypeError, (error as Error & { code: string }).code) }\nconsole.log('getter reads:', reads)",
        "import { emitOutput } from '@migaia/serialize'\n\nlet reads = 0\nconst settings = { get token() { reads += 1; return '示例内容' } }\ntry { emitOutput(settings) }\ncatch (error) { console.log('拒绝:', error instanceof TypeError, (error as Error & { code: string }).code) }\nconsole.log('getter 读取次数:', reads)"
      ),
      result: t(
        'Prints `rejected: true INVALID_OPTION`, then `getter reads: 0`.\n\nThis accessor is rejected without executing its getter, and no partial string is returned. The boundary accepts plain records or dense arrays containing supported scalar/data values; it is not a general object serializer and does not promise to avoid Proxy traps while inspecting descriptors.',
        '依次输出 `拒绝: true INVALID_OPTION`、`getter 读取次数: 0`。\n\n这个访问器在没有执行 getter 的情况下被拒绝，也没有返回部分字符串。边界接纳由支持的标量及数据值组成的普通记录或稠密数组，不是任意对象序列化器，检查描述器时也不承诺避开 Proxy 陷阱。'
      )
    }
  ],
  encodeStream: [
    {
      title: t(
        'Process independent array slices without joining JSON documents',
        '逐片处理数组，不把多个 JSON 文档直接拼接'
      ),
      problem: t(
        'A large export is encoded into one full array string before its first piece can be processed, retaining the complete encoded document in memory.\n\nSplitting an array is not enough if the caller later concatenates the JSON strings: `[1,2]` followed by `[3,4]` is two documents, not one JSON array. The stream needs a receiver that understands each slice as its own frame.\n\nThis example also needs `@migaia/utils` installed for its scheduler. Call `encodeStream()` with that scheduler and the registry, then consume chunks as separate frames. The fixed bounds emit two items per slice; `maxInFlight: 1` encodes one slice at a time.',
        '大数组导出先编码成完整字符串，第一片数据能被处理前，就必须在内存里保留整份编码文档。\n\n只把数组分片还不够；之后直接拼接 JSON 字符串，会把 `[1,2]` 和 `[3,4]` 变成两个相邻文档，而不是一个 JSON 数组。接收方必须把每片当作独立帧处理。\n\n这个独立示例直接导入调度器，运行前应同时安装 `@migaia/serialize` 和 `@migaia/utils`。向 `encodeStream()` 传入注册表和调度器，逐个消费产生的片段。示例把分片上下限固定为两项，`maxInFlight: 1` 等待每片编码结束后才接纳下一片。'
      ),
      example: t(
        "import { createSerializeRegistry, jsonPlugin, chunkToText } from '@migaia/serialize'\nimport { encodeStream } from '@migaia/serialize/core'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst registry = createSerializeRegistry([jsonPlugin()])\ntry {\n  const chunks = encodeStream(registry, [1, 2, 3, 4, 5], {\n    scheduler: systemScheduler, minItems: 2, maxItems: 2, initialItems: 2, maxInFlight: 1\n  })\n  for await (const chunk of chunks) console.log('frame:', chunkToText(chunk, new TextDecoder()))\n} finally { await registry.dispose() }",
        "import { createSerializeRegistry, jsonPlugin, chunkToText } from '@migaia/serialize'\nimport { encodeStream } from '@migaia/serialize/core'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst registry = createSerializeRegistry([jsonPlugin()])\ntry {\n  const chunks = encodeStream(registry, [1, 2, 3, 4, 5], {\n    scheduler: systemScheduler, minItems: 2, maxItems: 2, initialItems: 2, maxInFlight: 1\n  })\n  for await (const chunk of chunks) console.log('独立片段:', chunkToText(chunk, new TextDecoder()))\n} finally { await registry.dispose() }"
      ),
      result: t(
        'Prints `frame: [1,2]`, `frame: [3,4]`, then `frame: [5]`.\n\nEach chunk contains one independently encoded slice in input order. Consume them as frames; this API does not assemble a single document or serialize each item as one continuous JSON array. The default `maxInFlight` is 1; higher values overlap requests but retain more in-flight data, and an early consumer return cancels queued operations without forcibly interrupting parser code.',
        '依次输出 `独立片段: [1,2]`、`独立片段: [3,4]`、`独立片段: [5]`。\n\n每个片段都包含一份独立编码的切片，按输入顺序交付，应按独立帧消费；此 API 不拼装单份文档，也不把各片变成一个连续 JSON 数组。`maxInFlight` 默认 1，调大可重叠请求，但会保留更多在途数据；消费方提前退出会取消排队操作，不会强行中断解析器代码。'
      )
    }
  ]
}
