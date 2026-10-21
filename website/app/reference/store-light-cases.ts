import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems the store-light APIs solve, each told as the symptom, why the usual approach fails and
 * how the API fixes it, then a runnable example and its observed output. Every example was run with
 * Node 24 against the built package and its printed output is described in `result`.
 */
export const storeLightCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createStore: [
    {
      title: t('Plain object in, reactive state out', '写普通对象，就得到响应式状态'),
      problem: t(
        'A cart keeps a list, a total and a summary line. Hand-written, every method that changes the list must also recompute the summary and notify listeners, and a listener that runs between two writes sees a new list with the old total.\n\nReactive libraries fix that, but usually by asking you to wrap every field in a signal and every derived value in a computed, so the state no longer looks like the object it describes.\n\n`createStore` takes the object as you would write it. Plain fields become writable reactive values, getters become derived values that recompute when what they read changes, and methods become actions: all writes inside one call are published together when the call returns.',
        '购物车有商品列表、合计和一行摘要。手写时，每个改列表的方法都要记得重算摘要、通知监听者；监听者如果在两次写入之间运行，看到的是新列表配旧合计。\n\n响应式库能解决这个问题，但通常要求把每个字段包成 signal、每个派生值包成 computed，状态就不再像它描述的那个对象了。\n\n`createStore` 直接接收你平时写的对象：普通字段变成可写的响应式值，getter 变成派生值，读到的字段变了它就重算；方法变成 Action，一次调用里的所有写入在方法返回时一起发布。'
      ),
      example: {
        en: `import { createStore } from '@migaia/store-light'

const cart = createStore({
  items: [] as string[],
  total: 0,
  // A getter becomes a derived value: it follows items and total
  get summary() {
    return \`items: \${this.items.length}, total: \${this.total}\`
  },
  // A method becomes an Action: its writes merge into one notification
  add(name: string, price: number) {
    this.items = [...this.items, name]
    this.total += price
  }
})

const stop = cart.$subscribe(() => console.log(\`notified: \${cart.summary}\`))

cart.add('keyboard', 300)
cart.add('mouse', 100)
await Promise.resolve() // notifications go out in a microtask

stop()
await cart.$dispose()`,
        zh: `import { createStore } from '@migaia/store-light'

const cart = createStore({
  items: [] as string[],
  total: 0,
  // getter 自动变成派生值：items 或 total 变了，它跟着变
  get summary() {
    return \`\${this.items.length} 件，共 \${this.total} 元\`
  },
  // 方法自动变成 Action：里面的多次写入合并成一次通知
  add(name: string, price: number) {
    this.items = [...this.items, name]
    this.total += price
  }
})

const stop = cart.$subscribe(() => console.log(\`通知：\${cart.summary}\`))

cart.add('键盘', 300)
cart.add('鼠标', 100)
await Promise.resolve() // 通知在微任务里发出

stop()
await cart.$dispose()`
      },
      result: t(
        "Two calls to `add` produce two notifications, and each one already sees both the new list and the new total.\n\nAn action publishes once, right when it returns, so a listener never observes half of a method's writes. Writes made directly on fields, outside any method, are merged in the next microtask instead.",
        '调用两次 `add`，收到两次通知，每次通知里列表和合计都已经是新的。\n\nAction 在返回时立即发布一次，监听者不会看到一个方法只写了一半的状态。不在方法里、直接给字段赋值的写入，则在下一个微任务里合并。'
      )
    },
    {
      title: t(
        'Save only what can be restored, and see what was dropped',
        '只保存能恢复的字段，并知道丢了哪些'
      ),
      problem: t(
        "Settings are saved to local storage. After an upgrade some saved fields no longer exist and new ones were added; restoring the old JSON either writes keys the state does not have or silently loses data nobody noticed.\n\nHand-written persistence usually serializes the whole object, including derived values and methods, and restores with `Object.assign`, which copies whatever it is given.\n\n`$plain()` returns only the writable fields. `$hydrate()` writes back only the fields this store has, in one batch; with `unknown: 'report'` it calls `onUnknown` for every key it skips, and `unknown: 'strict'` rejects the whole input instead.",
        "设置项保存在本地存储里。升级之后，有些旧字段已经删掉，又新增了字段；恢复旧 JSON 时，要么写进状态里没有的键，要么悄悄丢掉数据却没人发现。\n\n手写持久化通常把整个对象序列化，派生值和方法也带上，恢复时用 `Object.assign`，给什么就拷什么。\n\n`$plain()` 只返回可写字段。`$hydrate()` 只写回这个 store 有的字段，并在一个批次里完成；传 `unknown: 'report'` 时，每跳过一个键就调用一次 `onUnknown`，传 `unknown: 'strict'` 则整份输入直接拒绝。"
      ),
      example: {
        en: `import { createStore } from '@migaia/store-light'

const settings = createStore({
  theme: 'light',
  fontSize: 14,
  get label() {
    return \`\${this.theme} / \${this.fontSize}px\`
  },
  reset() {
    this.theme = 'light'
    this.fontSize = 14
  }
})

settings.$set({ theme: 'dark', fontSize: 16 })
// Only writable fields: derived values and methods are not saved
const saved = JSON.stringify(settings.$plain())
console.log(\`saved: \${saved}\`)

// The next version dropped fontSize and added language; old data also has a retired field
const next = createStore({ theme: 'light', language: 'en' })
next.$hydrate(
  { ...JSON.parse(saved), legacyMode: true },
  { unknown: 'report', onUnknown: (key) => console.log(\`ignored unknown field: \${key}\`) }
)
console.log(\`restored: \${JSON.stringify(next.$plain())}\`)

await settings.$dispose()
await next.$dispose()`,
        zh: `import { createStore } from '@migaia/store-light'

const settings = createStore({
  theme: 'light',
  fontSize: 14,
  get label() {
    return \`\${this.theme} / \${this.fontSize}px\`
  },
  reset() {
    this.theme = 'light'
    this.fontSize = 14
  }
})

settings.$set({ theme: 'dark', fontSize: 16 })
// 只取可写字段：派生值和方法不会被存进去
const saved = JSON.stringify(settings.$plain())
console.log(\`保存：\${saved}\`)

// 下个版本删掉了 fontSize，新增了 language；旧数据里还有 fontSize 和一个已废弃的字段
const next = createStore({ theme: 'light', language: 'zh' })
next.$hydrate(
  { ...JSON.parse(saved), legacyMode: true },
  { unknown: 'report', onUnknown: (key) => console.log(\`忽略未知字段：\${key}\`) }
)
console.log(\`恢复后：\${JSON.stringify(next.$plain())}\`)

await settings.$dispose()
await next.$dispose()`
      },
      result: t(
        "The saved JSON contains `theme` and `fontSize` but not `label` or `reset`. Restoring into the new version reports `fontSize` and `legacyMode` as ignored, and the result keeps `theme` and the new `language`.\n\nThe default `unknown: 'ignore'` skips unknown keys silently; choose `report` when you want to log migrations and `strict` when bad input must not be applied at all.",
        "保存的 JSON 里只有 `theme` 和 `fontSize`，没有 `label` 和 `reset`。恢复到新版本时，`fontSize` 和 `legacyMode` 被报告为已忽略，结果保留了 `theme` 和新增的 `language`。\n\n默认的 `unknown: 'ignore'` 会静默跳过未知键；想记录迁移情况就用 `report`，输入有误就必须整份拒绝时用 `strict`。"
      )
    },
    {
      title: t('Reading a released store fails loudly', '读取已释放的 store 会明确报错'),
      problem: t(
        "After sign-out the session state is released, but a timer or a callback that was never cleaned up keeps reading it and quietly shows the previous user's name.\n\nA plain object never knows it is no longer in use, so stale readers get old values instead of an error, and the bug only shows up as wrong data.\n\nAfter `$dispose()`, reading or writing a field and calling a method throw `STORE_DISPOSED`. `$disposed` turns `true` before any resource is released, and repeated `$dispose()` calls return the same Promise.",
        '退出登录后会话状态已经释放，但某个没清理的定时器或回调还在读它，悄悄显示出上一个用户的名字。\n\n普通对象不知道自己已经不用了，过期的读取方拿到的是旧值而不是错误，问题只会表现为数据不对。\n\n调用 `$dispose()` 之后，读写字段、调用方法都会抛 `STORE_DISPOSED`。`$disposed` 在释放任何资源之前就变成 `true`；重复调用 `$dispose()` 返回同一个 Promise。'
      ),
      example: {
        en: `import { createStore } from '@migaia/store-light'

const session = createStore({ user: 'Ada' })
await session.$dispose() // the user signs out and the session state is released

try {
  console.log(session.user) // a callback that was never cleaned up still reads it
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log(\`read failed: \${failure.code}\`)
}
console.log(\`disposed: \${session.$disposed}\`)`,
        zh: `import { createStore } from '@migaia/store-light'

const session = createStore({ user: 'Ada' })
await session.$dispose() // 用户退出登录，会话状态被释放

try {
  console.log(session.user) // 某个还没清理的回调仍在读取
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log(\`读取失败：\${failure.code}\`)
}
console.log(\`已释放：\${session.$disposed}\`)`
      },
      result: t(
        'The late read fails with `STORE_DISPOSED`, and `$disposed` is `true`.\n\nA forgotten reader now shows up as an error at the exact place it reads, instead of as stale data on screen.',
        '迟到的读取以 `STORE_DISPOSED` 失败，`$disposed` 为 `true`。\n\n被遗忘的读取方现在会在读取的那一行报错，而不是在界面上显示过期数据。'
      )
    }
  ],
  raw: [
    {
      title: t('Keep a callback as a replaceable field', '把回调保存成可替换的字段'),
      problem: t(
        'A form stores an `onSubmit` callback that the page swaps at run time. Written as a function in the store definition, it is treated as a method instead.\n\n`createStore` turns every function into an action, so a function-valued field cannot be told apart from a method by looking at the object.\n\nWrapping the value in `raw()` marks it as data: the field stays readable and writable, assigning a new function notifies subscribers, and calling it runs the current function.',
        '表单在 store 里保存一个 `onSubmit` 回调，页面运行时会更换它。直接把函数写进 store 定义，它会被当成方法。\n\n`createStore` 会把每个函数都变成 Action，光看对象没法分辨一个函数是字段还是方法。\n\n用 `raw()` 包住这个值，就把它标记为数据：字段可读可写，赋一个新函数会通知订阅者，调用时执行的是当前的函数。'
      ),
      example: {
        en: `import { createStore, raw } from '@migaia/store-light'

const form = createStore({
  // A function without raw would become a method; here it is a replaceable callback field
  onSubmit: raw((data: string) => console.log(\`default submit: \${data}\`)),
  submit(data: string) {
    this.onSubmit(data)
  }
})

const stop = form.$subscribe(() => console.log('submit callback replaced'))
form.submit('draft')

form.onSubmit = (data) => console.log(\`sent to the server: \${data}\`)
await Promise.resolve()
form.submit('final')

stop()
await form.$dispose()`,
        zh: `import { createStore, raw } from '@migaia/store-light'

const form = createStore({
  // 不包 raw 的函数会被当成方法；这里要的是一个可以替换的回调字段
  onSubmit: raw((data: string) => console.log(\`默认提交：\${data}\`)),
  submit(data: string) {
    this.onSubmit(data)
  }
})

const stop = form.$subscribe(() => console.log('提交回调已更换'))
form.submit('草稿')

form.onSubmit = (data) => console.log(\`发送到服务器：\${data}\`)
await Promise.resolve()
form.submit('正式稿')

stop()
await form.$dispose()`
      },
      result: t(
        'The first submit runs the default callback; replacing it notifies the subscriber, and the second submit runs the new one.\n\nUse `raw()` for any function or value that should be stored as is rather than interpreted, such as callbacks, class instances handed in from outside, or formatter functions.',
        '第一次提交运行默认回调；更换回调时订阅者收到通知，第二次提交运行的是新回调。\n\n凡是要原样保存、不希望被解释的值，例如回调、外部传入的类实例、格式化函数，都用 `raw()` 包住。'
      )
    }
  ],
  createStoreResource: [
    {
      title: t(
        'Release an async value when nobody uses it any more',
        '没人使用之后自动释放异步加载的值'
      ),
      problem: t(
        'A component opens a connection or a decoder when it mounts. When the last component that needs it unmounts it should be closed, but not immediately, because the next page often needs it again.\n\nHand-written code counts users in a module variable, and every early return or thrown error in a component is a chance to miss a decrement, leaving the resource open forever.\n\n`createStoreResource` owns the loaded value. `retainResource()` returns a release function; when no holder is left, the value stays for `keepAliveMs` (default 1000) and then `dispose` is called once.',
        '组件挂载时打开一个连接或解码器，最后一个需要它的组件卸载后应该关掉它，但又不该马上关，因为下一个页面往往还要用。\n\n手写时用一个模块变量数使用者，组件里任何一次提前返回或抛错都可能漏掉一次减一，资源就一直开着。\n\n`createStoreResource` 持有加载到的值。`retainResource()` 返回一个释放函数；没有任何持有者之后，值再保留 `keepAliveMs`（默认 1000 毫秒），然后调用一次 `dispose`。'
      ),
      example: {
        en: `import { createStoreResource } from '@migaia/store-light'

// Fake object that holds a resource, such as an open connection or a decoder
function openConnection(name: string) {
  console.log(\`open \${name}\`)
  return { name }
}

const connection = createStoreResource(() => openConnection('connection #1'), {
  keepAliveMs: 20, // keep it 20 ms after the last user leaves
  dispose: (value) => console.log(\`close \${value.name}\`)
})

const release = connection.retainResource() // a component mounts and starts using it
connection.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(\`read: \${connection.read().name}\`)

release() // the component unmounts
console.log('component unmounted')
await new Promise((resolve) => setTimeout(resolve, 50))
console.log('done')`,
        zh: `import { createStoreResource } from '@migaia/store-light'

// 模拟一个占用资源的对象，例如打开的连接或解码器
function openConnection(name: string) {
  console.log(\`打开 \${name}\`)
  return { name }
}

const connection = createStoreResource(() => openConnection('连接 #1'), {
  keepAliveMs: 20, // 没人使用后再保留 20ms
  dispose: (value) => console.log(\`关闭 \${value.name}\`)
})

const release = connection.retainResource() // 组件挂载，开始使用
connection.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(\`读取：\${connection.read().name}\`)

release() // 组件卸载，不再使用
console.log('组件卸载')
await new Promise((resolve) => setTimeout(resolve, 50))
console.log('结束')`
      },
      result: t(
        'The connection opens once, is read while the component holds it, and closes about 20 ms after the component unmounts.\n\nWhen no `dispose` option is given and the value has a `$dispose` method, that method is called instead. `keepAliveMs: 0` releases synchronously when the last holder leaves.',
        '连接只打开一次，组件持有期间可以读取，组件卸载约 20 毫秒后关闭。\n\n没有传 `dispose` 选项、而值自带 `$dispose` 方法时，会改为调用它。`keepAliveMs: 0` 表示最后一个持有者离开时立即同步释放。'
      )
    },
    {
      title: t(
        'Reloading releases the old value exactly once',
        '重新加载时，旧值被释放且只释放一次'
      ),
      problem: t(
        'A reload creates a new decoder. The old one must be released, but only after the new one is ready, so the screen never shows nothing, and it must never be released twice.\n\nHand-written reload code tends to dispose the old value before the new one arrives, or forgets it once an error path is taken; values that resolve after being superseded leak entirely.\n\n`retry()` starts a new load and keeps the old value until the new one is published, then disposes the old one once. Values that arrive after being superseded, or after the resource is disposed, are released as well.',
        '重新加载会创建一个新的解码器。旧的必须释放，但要等新的准备好之后再释放，界面才不会空着；而且绝不能释放两次。\n\n手写的重新加载代码，往往在新值到达之前就释放了旧值，或者走到错误分支时忘了释放；被取代之后才返回的值更是直接泄漏。\n\n`retry()` 发起新的加载，在新值发布之前一直保留旧值，之后把旧值释放一次。被取代之后才到达的值、资源释放之后才到达的值，也都会被释放。'
      ),
      example: {
        en: `import { createStoreResource } from '@migaia/store-light'

let opened = 0
const decoder = createStoreResource(
  () => {
    opened++
    console.log(\`create decoder #\${opened}\`)
    return { id: opened }
  },
  { dispose: (value) => console.log(\`release decoder #\${value.id}\`) }
)

const release = decoder.retainResource()
decoder.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(\`using #\${decoder.read().id}\`)

decoder.retry() // the user clicks "Reload"
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(\`using #\${decoder.read().id}\`)

release()
decoder.dispose()
await decoder.whenTerminal()
console.log('everything released')`,
        zh: `import { createStoreResource } from '@migaia/store-light'

let opened = 0
const decoder = createStoreResource(
  () => {
    opened++
    console.log(\`创建解码器 #\${opened}\`)
    return { id: opened }
  },
  { dispose: (value) => console.log(\`释放解码器 #\${value.id}\`) }
)

const release = decoder.retainResource()
decoder.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(\`正在使用 #\${decoder.read().id}\`)

decoder.retry() // 用户点“重新加载”
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(\`正在使用 #\${decoder.read().id}\`)

release()
decoder.dispose()
await decoder.whenTerminal()
console.log('全部释放完成')`
      },
      result: t(
        'Decoder #2 is created first, then #1 is released, and the component reads #2. Disposing the resource releases #2, and `whenTerminal()` resolves after everything is released.\n\nEach value created by the loader is released exactly once, whichever way it ends.',
        '先创建 #2，再释放 #1，组件读到的是 #2。释放资源时释放了 #2，`whenTerminal()` 在全部释放完成后才完成。\n\n加载函数创建的每个值，不管以哪种方式结束，都只被释放一次。'
      )
    }
  ]
}
