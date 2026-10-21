import type { ICaseDoc, IText } from './contract.js'

/** Localizes explanations while preserving executable public-entry examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Contract data, error projection and physical assembly remain separate from request execution. */
export const rpcContractCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  normalizePortable: [
    {
      title: t('Capture data before the caller changes it', '在调用者修改前捕获数据'),
      problem: t(
        'An adapter validates a payload, then the caller changes its nested object or byte array before encoding. The message should keep the values admitted at the validation boundary.\n\nKeeping the original object lets later mutations change what is sent. A shallow spread still shares nested records and bytes, so it does not establish a stable payload snapshot.\n\nnormalizePortable creates a frozen portable snapshot. The default wire profile copies records and converts Uint8Array bytes into a canonical unpadded Base64URL tag; it does not send a request.',
        '适配器校验载荷后，调用者在编码前又修改了嵌套对象或字节数组，消息应保留校验边界接纳的值。\n\n保留原对象会让后续修改改变发送内容，浅层展开仍共享嵌套记录与字节，无法建立稳定的载荷快照。\n\n`normalizePortable` 创建冻结的可移植快照，默认线上形态复制记录，并把 `Uint8Array` 字节转成规范的不带填充 Base64URL 标签，不会发送请求。'
      ),
      example: t(
        "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))",
        "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))"
      ),
      result: t(
        'Prints `{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}` and `true`. Later source mutations do not change the captured name or the encoded bytes.\n\nOrdinary records become frozen null-prototype snapshots. This default profile produces a bytes tag, not a restored Uint8Array; negotiated native-binary paths have a separate contract. Getters on ordinary wire records are read once and can execute user code.',
        '逐行输出 `{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}`、`true`，后续修改没有改变已捕获的名字或字节编码。\n\n普通记录变成冻结的空原型快照，默认形态产出字节标签，不会恢复为 `Uint8Array`；协商后的原生二进制另有契约，普通线上记录的访问器会读取一次并可能执行用户代码。'
      )
    },
    {
      title: t(
        'Reject values that cannot preserve their meaning on the wire',
        '拒绝在线上传输时会失去原意的值'
      ),
      problem: t(
        'A nonfinite measurement can be silently saved as null, while a cyclic payload cannot form a finite wire tree. Both should be rejected before an adapter commits to sending the message.\n\nJSON.stringify changes NaN to null inside a record. Checking only the top-level object misses invalid descendants and cycles that appear deeper in the payload.\n\nnormalizePortable walks the supported value tree and rejects invalid descendants. Compare the JSON result with the categorized TypeError, then submit a separate cyclic object through the same public entry.',
        '非有限计量值可能被悄悄保存为 `null`，带环载荷则无法形成有限线上树，两者都应在适配器决定发送消息前拒绝。\n\n`JSON.stringify` 会把记录里的 `NaN` 改成 `null`，只检查顶层对象又会漏掉深处的非法后代与环。\n\n`normalizePortable` 遍历支持的值树并拒绝非法后代，对照 JSON 结果与带分类的 `TypeError`，再用同一公开入口接收另一个带环对象。'
      ),
      example: t(
        "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconsole.log(JSON.stringify({ total: Number.NaN }))\ntry {\n  normalizePortable({ total: Number.NaN })\n} catch (error) {\n  console.log('nonfinite:', error instanceof TypeError, (error as { code: string }).code)\n}\nconst cycle: { self?: unknown } = {}\ncycle.self = cycle\ntry {\n  normalizePortable(cycle)\n} catch (error) {\n  console.log('cycle:', error instanceof TypeError, (error as { code: string }).code)\n}",
        "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconsole.log(JSON.stringify({ total: Number.NaN }))\ntry {\n  normalizePortable({ total: Number.NaN })\n} catch (error) {\n  console.log('非有限值:', error instanceof TypeError, (error as { code: string }).code)\n}\nconst cycle: { self?: unknown } = {}\ncycle.self = cycle\ntry {\n  normalizePortable(cycle)\n} catch (error) {\n  console.log('循环:', error instanceof TypeError, (error as { code: string }).code)\n}"
      ),
      result: t(
        'Prints `{"total":null}`, `nonfinite: true INVALID_ENVELOPE`, then `cycle: true INVALID_ENVELOPE`. Validation neither substitutes a finite value nor accepts a recursive reference.\n\nThe default domain includes null, booleans, finite numbers, strings, arrays, plain records and portable bytes. Its maximum depth is 64 with root depth 0; Date, Map, Set, functions and unsupported primitive values are not admitted.',
        '逐行输出 `{"total":null}`、`非有限值: true INVALID_ENVELOPE`、`循环: true INVALID_ENVELOPE`，校验没有替换非法数字，也没有接纳递归引用。\n\n默认值域含 `null`、布尔、有限数、字符串、数组、普通记录及可移植字节，根深度为 `0`，最大深度 `64`；不接纳 `Date`、`Map`、`Set`、函数及其他不支持的原始值。'
      )
    }
  ],
  serializeRpcError: [
    {
      title: t(
        'Preserve native error classes and remote cause stacks',
        '保留原生错误类型与远端原因堆栈'
      ),
      problem: t(
        'A remote operation fails with a TypeError caused by a RangeError. The receiver needs both semantic codes and the original stacks to understand which operation failed and why.\n\nSending only error.message drops the cause tree, native classes and stacks. Creating a fresh local error from that text assigns a receiving-side stack that hides the original failure location.\n\nserializeRpcError projects a bounded coded tree, and deserializeRpcError validates it before restoring native classes. Supply the required report callback to retain any fields that cannot be read or normalized.',
        '远端操作因范围错误而抛出类型错误，接收方需要两层语义码和原始堆栈，才能辨认失败操作及根因。\n\n只发送错误消息会丢掉原因树、原生类型与堆栈，用该文字在本地重建错误，又会生成接收端堆栈并掩盖原始失败位置。\n\n`serializeRpcError` 投影有界带码树，`deserializeRpcError` 校验后恢复原生类型，须提供 `report` 回调以保留无法读取或规范化字段的失败。'
      ),
      example: t(
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('limit exceeded')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('request failed', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)",
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('超过限制')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('请求失败', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)"
      ),
      result: t(
        'Prints `true true`, `true true`, then `REQUEST LIMIT 0`. Both native classes and stack strings survive the round trip, both semantic codes remain present, and no field failures are reported.\n\nRestoration creates new Error objects, so cross-boundary object identity is not preserved. The tree is bounded and can carry cause, AggregateError errors and a truncation marker; no connection or request is executed by these functions.',
        '逐行输出 `true true`、`true true`、`REQUEST LIMIT 0`，往返保留两种原生类型、两份堆栈字符串和语义码，未报告字段失败。\n\n恢复会创建新的错误对象，不保留跨边界对象身份；错误树有界，可携带 `cause`、聚合错误子项和截断标记，这些函数不建立连接或执行请求。'
      )
    },
    {
      title: t(
        'Report unreadable error fields without losing the wire error',
        '报告不可读字段并继续生成线上错误'
      ),
      problem: t(
        'A diagnostic serializer encounters an Error whose message getter throws. Losing the whole diagnostic would hide both the original operation and the new field-read failure.\n\nDirect property reads while building a JSON object let the getter exception escape the logging path. Ignoring that exception instead removes evidence that a field was omitted.\n\nserializeRpcError captures supported fields and routes omitted read failures to report. Save the fixture stack before installing its hostile message getter, then collect each report record for inspection.',
        '诊断序列化遇到消息访问器会抛错的错误对象，丢弃整条诊断会同时掩盖原操作与新的字段读取失败。\n\n构建 JSON 对象时直接读取属性，会让访问器异常逃出日志路径，若忽略该异常，又会丢失字段被省略的依据。\n\n`serializeRpcError` 捕获支持字段，并把被省略的读取失败交给 `report`；本例先保存错误堆栈，再设置会抛错的消息访问器，收集报告记录供检查。'
      ),
      example: t(
        "import { serializeRpcError, type IRpcWireErrorFailure } from '@migaia/rpc-contract/errors'\n\nconst original = new TypeError('message access failed')\nconst failure = new Error('unreadable message')\nvoid failure.stack\nObject.defineProperty(failure, 'message', { get: () => { throw original } })\nconst reports: IRpcWireErrorFailure[] = []\nconst wire = serializeRpcError(failure, { report: (entry) => { reports.push(entry) } })\nconsole.log(wire.name, wire.code)\nconsole.log(reports.length, reports[0]?.field, reports[0]?.error === original)",
        "import { serializeRpcError, type IRpcWireErrorFailure } from '@migaia/rpc-contract/errors'\n\nconst original = new TypeError('消息读取失败')\nconst failure = new Error('不可读消息')\nvoid failure.stack\nObject.defineProperty(failure, 'message', { get: () => { throw original } })\nconst reports: IRpcWireErrorFailure[] = []\nconst wire = serializeRpcError(failure, { report: (entry) => { reports.push(entry) } })\nconsole.log(wire.name, wire.code)\nconsole.log(reports.length, reports[0]?.field, reports[0]?.error === original)"
      ),
      result: t(
        'Prints `Error UNKNOWN` and `1 message true`. A wire error is still returned, and the report identifies the unreadable message field with the exact original TypeError.\n\nreport is required and receives pointer, field and the original failure synchronously. These records are local diagnostic evidence, not extra wire fields. Untagged errors use the unknown source/code fallback; unreadable fields follow the bounded serializer policy.',
        '逐行输出 `Error UNKNOWN`、`1 message true`，仍返回线上错误，报告指出不可读的消息字段并保留原始 `TypeError`。\n\n`report` 必填，同步收到指针、字段和原始失败；这些记录是本地诊断依据，不是额外线上字段，未编码错误使用未知来源与错误码兜底，不可读字段遵守有界序列化策略。'
      )
    }
  ],
  createStringFramer: [
    {
      title: t(
        'Keep equal message identifiers from different peers separate',
        '隔离不同对端的相同消息标识'
      ),
      problem: t(
        'Two peers each send a fragmented message named job. Their chunks can interleave, but completing one message must not concatenate bytes from the other peer.\n\nA buffer map keyed only by messageId merges unrelated senders. Even ordered chunks then produce a plausible but incorrect combined value, or consume another sender assembly state.\n\ncreateStringFramer retains assemblies by source and messageId together. Set chunkBytes to 2, interleave the two first fragments, then finish each source separately and close the framer.',
        '两个对端分别发送标识为 `job` 的分片消息，分片可能交错，但完成一条消息时不能拼入另一个对端的数据。\n\n只用 `messageId` 建缓冲表会合并无关发送方，即使分片有序也可能得到看似合法的错误组合，或消费另一个发送方的组装状态。\n\n`createStringFramer` 共同使用 `source` 与 `messageId` 保存组装状态，把 `chunkBytes` 设为 `2`，交错接收两条首片，再分别完成并关闭分帧器。'
      ),
      example: t(
        "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 2 })\nconst a = { source: 'peer-a', messageId: 'job' }\nconst b = { source: 'peer-b', messageId: 'job' }\nconst first = framer.frame('abcd', a)\nconst second = framer.frame('wxyz', b)\nconsole.log(framer.accept(first[0]!, a).status, framer.accept(second[0]!, b).status)\nconst completedA = framer.accept(first[1]!, a)\nconst completedB = framer.accept(second[1]!, b)\nconsole.log(completedA.status === 'complete' ? completedA.value : completedA.status)\nconsole.log(completedB.status === 'complete' ? completedB.value : completedB.status)\nframer.close()",
        "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 2 })\nconst a = { source: 'peer-a', messageId: 'job' }\nconst b = { source: 'peer-b', messageId: 'job' }\nconst first = framer.frame('abcd', a)\nconst second = framer.frame('wxyz', b)\nconsole.log(framer.accept(first[0]!, a).status, framer.accept(second[0]!, b).status)\nconst completedA = framer.accept(first[1]!, a)\nconst completedB = framer.accept(second[1]!, b)\nconsole.log(completedA.status === 'complete' ? completedA.value : completedA.status)\nconsole.log(completedB.status === 'complete' ? completedB.value : completedB.status)\nframer.close()"
      ),
      result: t(
        'Prints `pending pending`, `abcd`, then `wxyz`. Both partial assemblies coexist despite sharing job as messageId, and each complete result contains only its own source data.\n\nThe caller owns trusted source attribution and message correlation; frame data does not authenticate a peer. This string profile counts UTF-16 code units despite the chunkBytes option name, requires ordered delivery, and releases retained timers through close().',
        '逐行输出 `pending pending`、`abcd`、`wxyz`，相同消息标识的两条部分组装可并存，完成结果分别只含自身来源的数据。\n\n调用者负责可信来源归属和消息关联，分片数据不认证对端；字符串形态虽用 `chunkBytes` 名称，实际按 UTF-16 码元计数，要求有序交付，并通过 `close()` 释放保留计时器。'
      )
    },
    {
      title: t(
        'Reject out-of-order chunks and close partial assemblies',
        '拒绝乱序分片并关闭未完成组装'
      ),
      problem: t(
        'A receiver sees the second fragment before the first, then shuts down after receiving only a prefix. It needs an explicit rejection result and a way to release the unfinished assembly.\n\nJoining whichever fragments arrive produces reordered payloads. Keeping the prefix after shutdown leaves assembly buffers and timeout ownership alive beyond the receiver lifetime.\n\ncreateStringFramer.accept returns pending, complete or rejected. Submit the out-of-order fragment, start a valid prefix, then call close() before another accept to observe the terminal ingress boundary.',
        '接收器先看到第二片，随后只取得前缀便关闭，需要明确的拒绝结果，也需要释放未完成组装的方式。\n\n按到达顺序直接拼接会形成乱序载荷，关闭后继续保存前缀则让缓冲与超时归属超出接收器生命周期。\n\n`createStringFramer.accept` 返回 `pending`、`complete` 或 `rejected`；先提交乱序片，再接收合法首片，随后关闭并再次接收，观察接收终态边界。'
      ),
      example: t(
        "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 2 })\nconst context = { source: 'peer-a', messageId: 'job' }\nconst frames = framer.frame('abcd', context)\nconst early = framer.accept(frames[1]!, context)\nconsole.log(early.status, early.status === 'rejected' ? (early.error as Error & { code: string }).code : '')\nconsole.log(framer.accept(frames[0]!, context).status)\nframer.close()\nconst closed = framer.accept(frames[1]!, context)\nconsole.log(closed.status, closed.status === 'rejected' ? (closed.error as Error & { code: string }).code : '')",
        "import { createStringFramer } from '@migaia/rpc-contract/framing'\n\nconst framer = createStringFramer({ chunkBytes: 2 })\nconst context = { source: 'peer-a', messageId: 'job' }\nconst frames = framer.frame('abcd', context)\nconst early = framer.accept(frames[1]!, context)\nconsole.log(early.status, early.status === 'rejected' ? (early.error as Error & { code: string }).code : '')\nconsole.log(framer.accept(frames[0]!, context).status)\nframer.close()\nconst closed = framer.accept(frames[1]!, context)\nconsole.log(closed.status, closed.status === 'rejected' ? (closed.error as Error & { code: string }).code : '')"
      ),
      result: t(
        'Prints `rejected INVALID_FRAME`, `pending`, then `rejected INVALID_FRAME`. The early second fragment is refused; after a valid prefix, close() prevents further acceptance.\n\nInvalid incoming fragments return categorized rejections, while invalid construction limits throw. close() clears assemblies and timers; this framer does not reorder or retry delivery, and frame-size, chunk-count and concurrency limits still apply.',
        '逐行输出 `rejected INVALID_FRAME`、`pending`、`rejected INVALID_FRAME`，过早的第二片被拒绝，合法前缀之后的关闭也阻止继续接收。\n\n非法入站分片返回带分类的拒绝结果，非法构造限制则抛错；`close()` 清理组装与计时器，此分帧器不负责重排或重试，消息大小、分片数与并发限制仍然生效。'
      )
    }
  ]
}
