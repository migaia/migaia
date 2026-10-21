import type { ICaseDoc, IText } from './contract.js'

/** Bilingual explanations accompany complete public-entry examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Request ownership, resource waits and script embedding have separate observable boundaries. */
export const storeSsrCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createSSRRequestScope: [
    {
      title: t(
        'Capture a request snapshot and release its owned store',
        '捕获请求快照并释放所拥有的状态'
      ),
      problem: t(
        'A page finishes rendering, but the live store changes before its state is serialized. The exported state should retain the values captured for that render, and request cleanup must release its owned store.\n\nKeeping a live nested object as the response payload lets later mutations rewrite the earlier result. A request handler that forgets store disposal also leaves subscriptions and cleanup jobs behind.\n\nInstall store-ssr and store-light directly. Create the Store with scope.runtime, register it, then call dehydrate() for a checked frozen snapshot and await disposeAsync() when the request ends.',
        '页面完成渲染后，状态容器在序列化前又发生变化，导出状态应保留该次渲染捕获的值，请求清理也须释放其拥有的容器。\n\n把嵌套活对象直接当响应载荷，会让后续修改改写此前结果；请求处理器若漏掉容器销毁，还会留下订阅与清理作业。\n\n直接安装 `store-ssr` 与 `store-light`，以 `scope.runtime` 创建容器并登记，再用 `dehydrate()` 取得经校验的冻结快照，请求结束时等待 `disposeAsync()`。'
      ),
      example: t(
        "import { createSSRRequestScope } from '@migaia/store-ssr'\nimport { createStore } from '@migaia/store-light'\n\nconst scope = createSSRRequestScope()\nconst cart = createStore({ count: 2 }, { runtime: scope.runtime })\nscope.register('cart', cart)\nconst snapshot = scope.dehydrate()\ncart.count = 3\nconsole.log(snapshot.stores.cart?.count, cart.count)\nconsole.log(Object.isFrozen(snapshot.stores.cart))\nawait scope.disposeAsync()\nconsole.log(cart.$disposed)",
        "import { createSSRRequestScope } from '@migaia/store-ssr'\nimport { createStore } from '@migaia/store-light'\n\nconst scope = createSSRRequestScope()\nconst cart = createStore({ count: 2 }, { runtime: scope.runtime })\nscope.register('cart', cart)\nconst snapshot = scope.dehydrate()\ncart.count = 3\nconsole.log(snapshot.stores.cart?.count, cart.count)\nconsole.log(Object.isFrozen(snapshot.stores.cart))\nawait scope.disposeAsync()\nconsole.log(cart.$disposed)"
      ),
      result: t(
        'Prints `2 3`, `true`, then `true`. The dehydrated count stays 2 after the live Store reaches 3; its snapshot is frozen, and the owned Store is disposed at request completion.\n\nRegistration owns the Store by default. dehydrate() validates, copies and freezes JSON data; dehydrateTrusted() retains live references instead. Scope cleanup does not dispose the Runtime itself, and the caller chooses one scope per request.',
        '逐行输出 `2 3`、`true`、`true`，活容器变为 `3` 后脱水值仍为 `2`，快照已冻结，请求完成时所拥有容器也已销毁。\n\n登记默认拥有容器，`dehydrate()` 校验、复制并冻结 JSON 数据，`dehydrateTrusted()` 则保留活引用；作用域清理不销毁运行时本体，由调用者为每请求创建独立作用域。'
      )
    },
    {
      title: t('Keep two requests in separate runtimes', '让两个请求使用各自的运行时'),
      problem: t(
        'Concurrent requests register the same profile key for different users. They need separate state and must reject a Store accidentally created for the other request.\n\nA module-level Runtime or shared registry lets request-specific state share one owner. Giving scopes different names cannot correct a Store that was constructed with the wrong Runtime.\n\ncreateSSRRequestScope creates a new Runtime by default. Build each real store-light Store with its own scope.runtime; register() checks exact Runtime identity before accepting the foreign candidate.',
        '并发请求为不同用户登记相同的个人资料键，需要隔离状态，也须拒绝误传另一个请求所创建的容器。\n\n模块级运行时或共享登记表会让请求状态归同一所有者，仅给作用域不同名字，无法纠正使用错误运行时构造的容器。\n\n`createSSRRequestScope` 默认创建新运行时，各真实 `store-light` 容器使用自身的 `scope.runtime`，`register()` 接纳前检查精确运行时身份。'
      ),
      example: t(
        "import { createSSRRequestScope } from '@migaia/store-ssr'\nimport { createStore } from '@migaia/store-light'\n\nconst first = createSSRRequestScope()\nconst second = createSSRRequestScope()\nconst alice = createStore({ user: 'Alice' }, { runtime: first.runtime })\nconst bob = createStore({ user: 'Bob' }, { runtime: second.runtime })\nfirst.register('profile', alice)\nsecond.register('profile', bob)\nconsole.log(first.runtime === second.runtime)\nconsole.log(first.dehydrate().stores.profile?.user, second.dehydrate().stores.profile?.user)\ntry {\n  first.register('foreign', bob)\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nawait Promise.all([first.disposeAsync(), second.disposeAsync()])",
        "import { createSSRRequestScope } from '@migaia/store-ssr'\nimport { createStore } from '@migaia/store-light'\n\nconst first = createSSRRequestScope()\nconst second = createSSRRequestScope()\nconst alice = createStore({ user: 'Alice' }, { runtime: first.runtime })\nconst bob = createStore({ user: 'Bob' }, { runtime: second.runtime })\nfirst.register('profile', alice)\nsecond.register('profile', bob)\nconsole.log(first.runtime === second.runtime)\nconsole.log(first.dehydrate().stores.profile?.user, second.dehydrate().stores.profile?.user)\ntry {\n  first.register('foreign', bob)\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nawait Promise.all([first.disposeAsync(), second.disposeAsync()])"
      ),
      result: t(
        'Prints `false`, `Alice Bob`, and `CROSS_RUNTIME`. The default scopes have different Runtimes, identical keys hold separate user values, and the foreign registration is refused.\n\nPassing the same explicit runtime to multiple scopes reuses it and does not create request isolation. runtime and runtimeOptions are mutually exclusive. Failed registration retains caller ownership; closing one scope does not release objects owned by the other.',
        '逐行输出 `false`、`Alice Bob`、`CROSS_RUNTIME`，默认作用域的运行时不同，相同键保存各自用户值，跨运行时登记被拒绝。\n\n向多个作用域显式传同一个 `runtime` 会复用它，不能获得请求隔离；`runtime` 与 `runtimeOptions` 互斥，登记失败后候选仍归调用者，关闭一个作用域不释放另一个拥有的对象。'
      )
    },
    {
      title: t(
        'Keep ready data when another resource exceeds the wait budget',
        '保留就绪数据并报告仍在途的资源'
      ),
      problem: t(
        'A render has one ready cache entry and one request still pending when its waiting budget ends. The completed entry should remain usable without being mislabeled as a timeout.\n\nTiming out an entire Promise.all call loses which resources actually settled. Retrying every resource discards available cache data and repeats work that already succeeded.\n\nInstall resource directly. dehydrateAsync({ timeoutMs: 0 }) classifies settled promises without waiting for pending work; onResourceError collects failures, and the ready Resource overrides its default ttl of Infinity with 60000 ms.',
        '渲染已有一项就绪缓存，等待预算结束时另一项请求仍在途中，已完成条目应继续可用，不应被误标为超时。\n\n对整个 `Promise.all` 统一报超时，会丢失各资源实际结算情况，全部重试又会丢弃可用缓存并重复已成功的工作。\n\n直接安装资源包，`dehydrateAsync({ timeoutMs: 0 })` 识别已结算结果而不等待在途工作，通过 `onResourceError` 收集失败，就绪资源将 `ttl` 的默认 `Infinity` 改为 `60000` 毫秒。'
      ),
      example: t(
        "import { createSSRRequestScope, type ISSRResourceFailure } from '@migaia/store-ssr'\nimport { Resource } from '@migaia/resource'\n\nconst scope = createSSRRequestScope()\nconst ready = new Resource(async () => 7, scope.runtime, { ttl: 60_000 })\nawait ready.promise\nlet finish!: (value: number) => void\nconst pending = new Resource(() => new Promise<number>((resolve) => {\n  finish = resolve\n}), scope.runtime)\nscope.registerResource('ready', ready)\nscope.registerResource('pending', pending)\nconst failures: ISSRResourceFailure[] = []\nconst state = await scope.dehydrateAsync({\n  timeoutMs: 0,\n  onResourceError: (failure) => { failures.push(failure) }\n})\nconsole.log(failures[0]?.key, (failures[0]?.error as Error & { code: string }).code)\nconsole.log(state.resources?.ready?.data)\nfinish(9)\nawait pending.promise\nawait scope.disposeAsync()",
        "import { createSSRRequestScope, type ISSRResourceFailure } from '@migaia/store-ssr'\nimport { Resource } from '@migaia/resource'\n\nconst scope = createSSRRequestScope()\nconst ready = new Resource(async () => 7, scope.runtime, { ttl: 60_000 })\nawait ready.promise\nlet finish!: (value: number) => void\nconst pending = new Resource(() => new Promise<number>((resolve) => {\n  finish = resolve\n}), scope.runtime)\nscope.registerResource('ready', ready)\nscope.registerResource('pending', pending)\nconst failures: ISSRResourceFailure[] = []\nconst state = await scope.dehydrateAsync({\n  timeoutMs: 0,\n  onResourceError: (failure) => { failures.push(failure) }\n})\nconsole.log(failures[0]?.key, (failures[0]?.error as Error & { code: string }).code)\nconsole.log(state.resources?.ready?.data)\nfinish(9)\nawait pending.promise\nawait scope.disposeAsync()"
      ),
      result: t(
        'Prints `pending RESOURCE_TIMEOUT` and `7`. Only the unresolved resource is reported; the successfully cached value remains in the dehydrated resource state. The example then resolves the pending loader and closes the scope.\n\ntimeoutMs defaults to no deadline and applies to the whole wait. A timeout does not abort underlying work. Resource inclusion follows resource.dehydrate(), without independently filtering failure keys; a stale cache can remain eligible.',
        '逐行输出 `pending RESOURCE_TIMEOUT`、`7`，仅未完成资源收到报告，成功缓存值仍在脱水资源状态中，随后示例完成在途加载并关闭作用域。\n\n`timeoutMs` 默认无截止期限，预算覆盖整个等待，超时不会中止底层工作；是否纳入由资源自身脱水决定，不会额外按失败键过滤，旧缓存仍可能符合纳入条件。'
      )
    }
  ],
  serializeSSRState: [
    {
      title: t(
        'Embed JSON without letting data close its script element',
        '内联 JSON 时避免数据提前关闭脚本元素'
      ),
      problem: t(
        'A user-supplied text contains </script>, an ampersand or Unicode line separators. Inlining ordinary JSON into an HTML script element can make the HTML parser treat data as markup.\n\nJSON.stringify escapes JSON syntax but does not remove a literal closing script tag from string contents. Escaping the whole document afterward can instead corrupt the JSON representation.\n\nserializeSSRState first validates the version-1 state and then escapes &, <, >, U+2028 and U+2029 with JSON-compatible sequences. deserializeSSRState reads the escaped text back and verifies the same value.',
        '用户文本包含 `</script>`、与号或 Unicode 行分隔符，把普通 JSON 内联进 HTML 脚本元素，可能让解析器把数据解释成标记。\n\n`JSON.stringify` 转义 JSON 语法，却不会去掉字符串中的字面关闭脚本标签，之后再转义整份页面又可能损坏 JSON 表示。\n\n`serializeSSRState` 先校验版本 `1` 状态，再用 JSON 兼容序列转义 `&`、`<`、`>`、U+2028 与 U+2029，用 `deserializeSSRState` 读回并核对同值。'
      ),
      example: t(
        "import { serializeSSRState, deserializeSSRState } from '@migaia/store-ssr'\n\nconst value = '</script>&\\u2028\\u2029'\nconst state = { version: 1 as const, stores: { page: { text: value } } }\nconst text = serializeSSRState(state)\nconsole.log(text.includes('<'), text.includes('&'), text.includes('\\u2028'), text.includes('\\u2029'))\nconsole.log(deserializeSSRState(text).stores.page?.text === value)",
        "import { serializeSSRState, deserializeSSRState } from '@migaia/store-ssr'\n\nconst value = '</script>&\\u2028\\u2029'\nconst state = { version: 1 as const, stores: { page: { text: value } } }\nconst text = serializeSSRState(state)\nconsole.log(text.includes('<'), text.includes('&'), text.includes('\\u2028'), text.includes('\\u2029'))\nconsole.log(deserializeSSRState(text).stores.page?.text === value)"
      ),
      result: t(
        'Prints `false false false false` and `true`. The serialized text contains none of the checked raw HTML-sensitive characters or line separators, while JSON parsing recovers the original string exactly.\n\nUse the returned text as JSON script content; the function does not add a script element. State version must be 1 and values must meet the supported JSON domain. Invalid parsed JSON retains SyntaxError with INVALID_STATE_SCRIPT.',
        '逐行输出 `false false false false`、`true`，序列化文本不含所检查的原始 HTML 敏感字符或行分隔符，JSON 解析仍精确恢复原字符串。\n\n返回文本用于 JSON 脚本正文，函数不添加脚本元素，状态版本须为 `1`，值须符合支持的 JSON 值域；非法 JSON 解析保留 `SyntaxError` 并附 `INVALID_STATE_SCRIPT`。'
      )
    }
  ],
  createSSRStateScript: [
    {
      title: t('Create the complete non-executable state element', '生成完整的不可执行状态元素'),
      problem: t(
        'A renderer has a validated state envelope but still needs a consistently named element for browser hydration. The response should include data without turning that JSON into executable JavaScript.\n\nHand-written tag templates can disagree about the element id or MIME type. Inlining the JSON without its matching escaping also reintroduces closing-tag handling into every renderer.\n\ncreateSSRStateScript validates the state and element id, serializes with HTML-compatible JSON escapes, and wraps the result in an application/json script. Omit elementId to use `__STORE_STATE__`.',
        '渲染器已有合法状态外层，还需要为浏览器复水生成名称一致的元素，响应应包含数据，而不把 JSON 变成可执行 JavaScript。\n\n手写标签模板容易在元素标识或 MIME 类型上不一致，没有配套转义便直接内联 JSON，还会让各渲染器重复处理关闭标签。\n\n`createSSRStateScript` 校验状态与元素标识，按 HTML 上下文转义 JSON，再包装为 `application/json` 脚本，省略 `elementId` 时使用 `__STORE_STATE__`。'
      ),
      example: t(
        "import { createSSRStateScript } from '@migaia/store-ssr'\n\nconst state = { version: 1 as const, stores: { app: { count: 2 } } }\nconsole.log(createSSRStateScript(state))",
        "import { createSSRStateScript } from '@migaia/store-ssr'\n\nconst state = { version: 1 as const, stores: { app: { count: 2 } } }\nconsole.log(createSSRStateScript(state))"
      ),
      result: t(
        'Prints `<script type="application/json" id="__STORE_STATE__">{"version":1,"stores":{"app":{"count":2}}}</script>`. The default id and non-executable JSON MIME type appear in the complete tag.\n\nThis function builds HTML text and does not insert DOM nodes or hydrate Stores. A browser reader can use readSSRStateFromDocument with the same id and an explicitly supplied document; that reader does not obtain a global document automatically.',
        '输出 `<script type="application/json" id="__STORE_STATE__">{"version":1,"stores":{"app":{"count":2}}}</script>`，完整标签包含默认标识与不可执行 JSON MIME 类型。\n\n此函数生成 HTML 文本，不插入 DOM 节点或复水容器，浏览器可用同一标识和显式文档调用 `readSSRStateFromDocument`，读取器不会自动取得全局文档。'
      )
    },
    {
      title: t(
        'Reject identifiers that can break the state element attribute',
        '拒绝会破坏状态元素属性的标识符'
      ),
      problem: t(
        'A renderer selects an element id from configuration. If quotes or whitespace are accepted, the value can escape its id attribute and change the generated markup.\n\nInterpolating an arbitrary configuration string into a tag treats that value as HTML syntax. Merely agreeing on an id between server and browser does not validate the attribute boundary.\n\ncreateSSRStateScript requires an id beginning with a letter or underscore, followed by letters, digits, underscores, colons, dots or hyphens. Show a valid custom id, then reject one containing a quote and spaces.',
        '渲染器从配置中选择元素标识，若接纳引号或空白，该值便可能逃出 `id` 属性并改变生成标记。\n\n把任意配置字符串插入标签，会把该值当成 HTML 语法，仅让服务端与浏览器约定同一标识，不能校验属性边界。\n\n`createSSRStateScript` 要求标识以字母或下划线开头，后续仅含字母、数字、下划线、冒号、点或连字符；先展示合法自定义标识，再拒绝带引号及空白的值。'
      ),
      example: t(
        "import { createSSRStateScript } from '@migaia/store-ssr'\n\nconst state = { version: 1 as const, stores: {} }\nconst html = createSSRStateScript(state, 'page-state')\nconsole.log(html.includes('id=\"page-state\"'))\ntry {\n  createSSRStateScript(state, 'state\" onclick=\"bad')\n} catch (error) {\n  console.log((error as Error).name, (error as { code: string }).code)\n}",
        "import { createSSRStateScript } from '@migaia/store-ssr'\n\nconst state = { version: 1 as const, stores: {} }\nconst html = createSSRStateScript(state, 'page-state')\nconsole.log(html.includes('id=\"page-state\"'))\ntry {\n  createSSRStateScript(state, 'state\" onclick=\"bad')\n} catch (error) {\n  console.log((error as Error).name, (error as { code: string }).code)\n}"
      ),
      result: t(
        'Prints `true` and `Error INVALID_STATE_SCRIPT`. The valid page-state id is rendered; the attempted attribute-breaking id is rejected before a tag is returned.\n\nThe default id is `__STORE_STATE__`, and empty or nonmatching ids reject. State data is separately validated and JSON-escaped; this identifier rule does not provide a general HTML sanitization policy for other markup.',
        '逐行输出 `true`、`Error INVALID_STATE_SCRIPT`，合法的 `page-state` 被写入，尝试突破属性边界的标识在返回标签前被拒绝。\n\n默认标识为 `__STORE_STATE__`，空或不匹配的标识会拒绝，状态数据另行校验并转义 JSON，此标识规则不替其他页面标记提供通用 HTML 清洗策略。'
      )
    }
  ]
}
