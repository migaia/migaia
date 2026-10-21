import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems the store-keyed APIs solve, each told as the symptom, why the usual approach fails and
 * how the API fixes it, then a runnable example and its observed output. Every example was run with
 * Node 24 against the built package and its printed output is described in `result`.
 */
export const storeKeyedCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createAtomStore: [
    {
      title: t(
        'One definition, a separate value per request or test',
        '一份定义，每个请求或测试各有一份值'
      ),
      problem: t(
        "State kept in a module-level variable is shared by everything that imports it. On a server, one request's cart shows up in another request; in tests, one case's leftovers break the next.\n\nThe usual fix is to wrap the state in a factory and thread the instance through every function that needs it, which changes every call site and still leaves object initial values shared by reference if someone forgets to copy them.\n\nHere the definition (`atomDef`, `derivedDef`) only describes the state and holds no value, so it can stay at module level. Each `createAtomStore` gives that definition its own value, and object or array initial values are cloned for every store.",
        '放在模块级变量里的状态，被所有导入它的代码共用。在服务端，一个请求的购物车会出现在另一个请求里；在测试里，上一个用例留下的数据会弄坏下一个。\n\n常见的修法是把状态包进工厂函数，再把实例传给每个需要它的函数，所有调用点都得改；而且如果有人忘了复制对象初值，几份状态仍然共用同一个对象。\n\n这里的定义（`atomDef`、`derivedDef`）只描述状态，不保存值，所以可以放在模块顶层。每个 `createAtomStore` 为这份定义各自保存一份值；对象和数组初值会在每个 store 里各复制一份。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// Definitions are written once at module level; they hold no value
const cartDef = atomDef({ items: [] as string[] }, 'cart')
const countDef = derivedDef((get) => get(cartDef).items.length, 'count')

// Each server request (or each test) creates its own store, which holds its own values
function handleRequest(user: string, items: string[]) {
  const store = createAtomStore(createRuntime())
  for (const item of items) store.set(cartDef, (cart) => ({ items: [...cart.items, item] }))
  console.log(\`items in \${user}'s cart: \${store.get(countDef)}\`)
  store.dispose()
}

handleRequest('Ada', ['keyboard', 'mouse'])
handleRequest('Grace', ['monitor'])

// An object initial value is copied per store, so mutating it in place cannot leak into another store
const a = createAtomStore(createRuntime())
const b = createAtomStore(createRuntime())
a.get(cartDef).items.push('accidental edit')
console.log(\`initial value in another store: \${JSON.stringify(b.get(cartDef))}\`)
a.dispose()
b.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// 定义只写一次，放在模块顶层；它不保存任何值
const cartDef = atomDef({ items: [] as string[] }, 'cart')
const countDef = derivedDef((get) => get(cartDef).items.length, 'count')

// 服务端每个请求（或每个测试用例）创建自己的 store，各自持有一份值
function handleRequest(user: string, items: string[]) {
  const store = createAtomStore(createRuntime())
  for (const item of items) store.set(cartDef, (cart) => ({ items: [...cart.items, item] }))
  console.log(\`\${user} 的购物车：\${store.get(countDef)} 件\`)
  store.dispose()
}

handleRequest('Ada', ['键盘', '鼠标'])
handleRequest('Grace', ['显示器'])

// 对象初值在每个 store 里各复制一份，原地修改也不会影响别的 store
const a = createAtomStore(createRuntime())
const b = createAtomStore(createRuntime())
a.get(cartDef).items.push('误改')
console.log(\`另一个 store 的初值：\${JSON.stringify(b.get(cartDef))}\`)
a.dispose()
b.dispose()`
      },
      result: t(
        "Ada's cart has 2 items and Grace's has 1, although both requests used the same definitions. Mutating the initial object in one store leaves the other store's initial value empty.\n\nThe definition is the shared vocabulary and the store is the place where values live. Dispose a store when its request or test ends to release every value it created.",
        'Ada 的购物车有 2 件，Grace 的有 1 件，两个请求用的是同一份定义。在一个 store 里原地修改初值对象，另一个 store 的初值仍然是空的。\n\n定义是共用的“词汇”，store 才是值存放的地方。请求或测试结束时释放对应的 store，它创建的所有值都会一起释放。'
      )
    },
    {
      title: t(
        'Swap one dependency in a test without touching the code under test',
        '测试时替换一个依赖，不用改被测代码'
      ),
      problem: t(
        'A price depends on the current hour, and testing the night discount means waiting until 22:00 or rewriting the code so the hour can be injected.\n\nInjecting every such dependency by hand spreads test-only parameters through production code, and global mocks of `Date` leak into unrelated tests.\n\n`store.override(definition, replacement)` routes reads of one definition to another inside this store only. The code under test keeps using the same definition tokens, and calling the returned function undoes the override.',
        '价格取决于当前时间，想测夜间折扣，要么等到晚上 10 点，要么改写代码让时间可以注入。\n\n把这类依赖都改成手动注入，会让只为测试存在的参数散落在生产代码里；全局替换 `Date` 又会影响无关的测试。\n\n`store.override(definition, replacement)` 只在这个 store 里把对一个定义的读取转到另一个定义。被测代码仍然使用原来的定义，调用返回的函数就能撤销替换。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// Code under test: the price is discounted depending on the current hour
const priceDef = atomDef(100, 'price')
const nowDef = derivedDef(() => new Date().getHours(), 'now')
const finalPriceDef = derivedDef((get) => (get(nowDef) >= 22 ? get(priceDef) * 0.5 : get(priceDef)), 'finalPrice')

// The test replaces "the current hour" with a fixed value; the definitions the code uses stay the same
const store = createAtomStore(createRuntime())
const undo = store.override(nowDef, derivedDef(() => 23))
console.log(\`price at 23:00: \${store.get(finalPriceDef)}\`)

undo()
store.override(nowDef, derivedDef(() => 9))
console.log(\`price at 09:00: \${store.get(finalPriceDef)}\`)
store.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// 被测代码：价格按当前时间决定是否打折
const priceDef = atomDef(100, 'price')
const nowDef = derivedDef(() => new Date().getHours(), 'now')
const finalPriceDef = derivedDef((get) => (get(nowDef) >= 22 ? get(priceDef) * 0.5 : get(priceDef)), 'finalPrice')

// 测试里把“当前时间”换成固定值，被测代码引用的定义不用改
const store = createAtomStore(createRuntime())
const undo = store.override(nowDef, derivedDef(() => 23))
console.log(\`23 点的价格：\${store.get(finalPriceDef)}\`)

undo()
store.override(nowDef, derivedDef(() => 9))
console.log(\`9 点的价格：\${store.get(finalPriceDef)}\`)
store.dispose()`
      },
      result: t(
        'With the hour fixed at 23 the price is 50; after undoing and fixing it at 9 the price is 100.\n\nAn override must keep the write contract: read-only definitions can be replaced by any definition of the same value type, writable ones only by definitions that are written the same way, otherwise a `TypeError` is thrown.',
        '时间固定为 23 点时价格是 50；撤销后固定为 9 点，价格是 100。\n\n替换必须保持写入方式不变：只读定义可以换成任何同值类型的定义，可写定义只能换成写法相同的定义，否则抛 `TypeError`。'
      )
    }
  ],
  focusDef: [
    {
      title: t('Subscribe to one field of a large object', '只订阅大对象里的一个字段'),
      problem: t(
        "A profile object holds the name, the avatar and the online flag. A component that only shows the name re-renders every time the online flag flips.\n\nSubscribing to the whole object is simplest, so every field change notifies every reader; splitting the object into separate stores instead forces every writer to update several places.\n\n`focusDef(profileDef, 'name')` is a definition for one field. Reading it subscribes only to that field's value, and writing it produces a new profile object with that field replaced.",
        "资料对象里有名字、头像和在线状态。只显示名字的组件，在线状态一变它也重新渲染。\n\n订阅整个对象最简单，于是任何字段一变，所有读取方都收到通知；改成把对象拆成几个独立的 store，写入方又得同时更新好几处。\n\n`focusDef(profileDef, 'name')` 是“这个字段”的定义。读取它只订阅这个字段的值；写入它会生成一个替换了该字段的新资料对象。"
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, focusDef } from '@migaia/store-keyed'

const profileDef = atomDef({ name: 'Ada', avatar: 'a.png', online: true }, 'profile')
// A component that only shows the name subscribes to this field, not to the whole profile
const nameDef = focusDef(profileDef, 'name')

const store = createAtomStore(createRuntime())
store.get(nameDef)
store.sub(nameDef, () => console.log(\`name updated: \${store.peek(nameDef)}\`))

store.set(profileDef, (profile) => ({ ...profile, online: false })) // only the online flag changes
store.set(nameDef, 'Ada Lovelace') // writing through the field definition updates the whole object
await Promise.resolve()

console.log(\`profile: \${JSON.stringify(store.peek(profileDef))}\`)
store.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, focusDef } from '@migaia/store-keyed'

const profileDef = atomDef({ name: 'Ada', avatar: 'a.png', online: true }, 'profile')
// 只关心名字的组件订阅这个字段，而不是整个资料对象
const nameDef = focusDef(profileDef, 'name')

const store = createAtomStore(createRuntime())
store.get(nameDef)
store.sub(nameDef, () => console.log(\`名字更新：\${store.peek(nameDef)}\`))

store.set(profileDef, (profile) => ({ ...profile, online: false })) // 只改在线状态
store.set(nameDef, 'Ada Lovelace') // 通过字段定义写回整个对象
await Promise.resolve()

console.log(\`资料对象：\${JSON.stringify(store.peek(profileDef))}\`)
store.dispose()`
      },
      result: t(
        "Changing the online flag does not notify the name subscriber; writing the new name does, and the profile object ends up with both changes.\n\nPaths can be up to three keys deep (`focusDef(def, 'user', 'address', 'city')`); for deeper paths combine several `focusDef`s or write an `opticDef`.",
        "修改在线状态时，名字的订阅者没有收到通知；写入新名字时收到了，资料对象最终包含两处修改。\n\n路径最多三层（`focusDef(def, 'user', 'address', 'city')`）；更深的路径可以组合多个 `focusDef`，或者写一个 `opticDef`。"
      )
    }
  ],
  splitDef: [
    {
      title: t(
        'Update one row without re-rendering the whole list',
        '改一行，不让整个列表重新渲染'
      ),
      problem: t(
        'Ticking one todo re-renders every row, because every row reads the same array and the array is replaced on every change.\n\nHand-written per-row subscriptions need a lookup by id, care when items are reordered or removed, and code that writes the change back into the array immutably.\n\n`splitDef(todosDef, (todo) => todo.id)` turns the array into one definition per key. Each row reads `todos.of(id)` and is notified only when its own item changes; writing the item writes a new array back to the source.',
        '勾选一条待办，整个列表的每一行都重新渲染，因为每一行读的都是同一个数组，而数组每次修改都会被替换。\n\n手写逐行订阅，要按 id 查找，要处理重新排序和删除，还要把修改不可变地写回数组。\n\n`splitDef(todosDef, (todo) => todo.id)` 把数组拆成按 key 的逐项定义。每一行读取 `todos.of(id)`，只在自己那一项变化时收到通知；写入这一项会把新数组写回源定义。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, splitDef } from '@migaia/store-keyed'

type ITodo = { id: string; title: string; done: boolean }
const todosDef = atomDef<ITodo[]>(
  [
    { id: 't1', title: 'write the weekly report', done: false },
    { id: 't2', title: 'fix the login bug', done: false }
  ],
  'todos'
)
// Split by id into one definition per item: each row subscribes only to its own item
const todos = splitDef(todosDef, (todo) => todo.id)

const store = createAtomStore(createRuntime())
for (const id of ['t1', 't2']) {
  const row = todos.of(id)
  store.get(row)
  store.sub(row, () => console.log(\`row \${id} re-renders: \${JSON.stringify(store.peek(row))}\`))
}

store.set(todos.of('t2'), (todo) => ({ ...todo, done: true })) // tick the second item
await Promise.resolve()
console.log(\`list: \${store.peek(todosDef).map((todo) => \`\${todo.id}=\${todo.done}\`).join(', ')}\`)
store.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, splitDef } from '@migaia/store-keyed'

type ITodo = { id: string; title: string; done: boolean }
const todosDef = atomDef<ITodo[]>(
  [
    { id: 't1', title: '写周报', done: false },
    { id: 't2', title: '修登录 bug', done: false }
  ],
  'todos'
)
// 按 id 拆成逐项定义：每一行只订阅自己那一项
const todos = splitDef(todosDef, (todo) => todo.id)

const store = createAtomStore(createRuntime())
for (const id of ['t1', 't2']) {
  const row = todos.of(id)
  store.get(row)
  store.sub(row, () => console.log(\`第 \${id} 行重新渲染：\${JSON.stringify(store.peek(row))}\`))
}

store.set(todos.of('t2'), (todo) => ({ ...todo, done: true })) // 勾选第二项
await Promise.resolve()
console.log(\`列表：\${store.peek(todosDef).map((todo) => \`\${todo.id}=\${todo.done}\`).join(', ')}\`)
store.dispose()`
      },
      result: t(
        'Only row `t2` re-renders, and the source list now has `t2` marked done.\n\nKeys must be unique: a duplicate key throws when the list is read. Reading or writing a key that has been removed from the array throws instead of returning stale data.',
        '只有 `t2` 这一行重新渲染，源列表里 `t2` 已标记为完成。\n\nkey 必须唯一：读取列表时遇到重复 key 会抛错。读写已经从数组里删除的 key 也会抛错，而不是返回过期数据。'
      )
    }
  ],
  familyDef: [
    {
      title: t(
        'One state per chat id, without a hand-written Map',
        '每个对话一份状态，不用手写 Map'
      ),
      problem: t(
        'Every chat needs its own draft. A hand-written `Map<chatId, state>` grows forever unless someone remembers to delete entries, and two lookups for the same id can create two different states.\n\nCaching by key looks trivial, but it has to return the same object for the same key, bound its size, and still work when the same chat is open in several independent scopes.\n\n`familyDef(initial)` returns a function from key to definition: the same key always gives the same definition token, so every store gives that chat its own value. `maxSize` (default 4096) bounds the cache, and `forget(key)` drops one key.',
        '每个对话都需要自己的草稿。手写的 `Map<chatId, state>` 只要没人记得删条目就会一直增长，而且同一个 id 查两次可能建出两份不同的状态。\n\n按 key 缓存看起来简单，但它必须对同一个 key 返回同一个对象、要有容量上限，还要在同一个对话被几个独立作用域同时打开时依然正确。\n\n`familyDef(initial)` 返回一个“key → 定义”的函数：同一个 key 永远得到同一个定义，于是每个 store 都为这个对话保存一份自己的值。`maxSize`（默认 4096）限制缓存大小，`forget(key)` 删除一个 key。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'
import { createAtomStore, derivedFamilyDef, familyDef } from '@migaia/store-keyed'

// One draft per chat: the same id always gives the same definition
const draftByChat = familyDef((chatId: string) => \`(empty draft for \${chatId})\`, { maxSize: 100 })
const lengthByChat = derivedFamilyDef((chatId: string) => (get) => get(draftByChat(chatId)).length)

const store = createAtomStore(createRuntime())
store.set(draftByChat('product'), 'ship tomorrow')
console.log(\`same id, same definition: \${draftByChat('product') === draftByChat('product')}\`)
console.log(\`product draft: \${store.get(draftByChat('product'))}, \${store.get(lengthByChat('product'))} characters\`)
console.log(\`engineering draft: \${store.get(draftByChat('engineering'))}\`)

draftByChat.forget('engineering') // the chat was deleted; stop caching its definition
console.log(\`cached chats: \${draftByChat.size}\`)
store.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'
import { createAtomStore, derivedFamilyDef, familyDef } from '@migaia/store-keyed'

// 每个对话一份草稿：同一个 id 永远得到同一个定义
const draftByChat = familyDef((chatId: string) => \`（\${chatId} 的空草稿）\`, { maxSize: 100 })
const lengthByChat = derivedFamilyDef((chatId: string) => (get) => get(draftByChat(chatId)).length)

const store = createAtomStore(createRuntime())
store.set(draftByChat('产品群'), '明天发版')
console.log(\`同一个 id 是同一个定义：\${draftByChat('产品群') === draftByChat('产品群')}\`)
console.log(\`产品群草稿：\${store.get(draftByChat('产品群'))}，\${store.get(lengthByChat('产品群'))} 个字\`)
console.log(\`技术群草稿：\${store.get(draftByChat('技术群'))}\`)

draftByChat.forget('技术群') // 对话被删除，不再缓存它的定义
console.log(\`缓存的对话数：\${draftByChat.size}\`)
store.dispose()`
      },
      result: t(
        'The same id returns the same definition, the product chat keeps its draft, the engineering chat starts from its initial draft, and after `forget` only one chat remains cached.\n\nBeyond `maxSize`, the least recently used entries are held weakly: a definition still referenced (for example instantiated in a store) is still found for the same key. This needs `WeakRef` and `FinalizationRegistry` in the host.',
        '同一个 id 得到同一个定义；产品群保留了它的草稿，技术群从初始草稿开始；`forget` 之后只剩一个对话被缓存。\n\n超过 `maxSize` 后，最久没用的条目改为弱引用：仍被引用的定义（例如已在某个 store 里实例化）用同一个 key 仍能找到。这需要宿主支持 `WeakRef` 和 `FinalizationRegistry`。'
      )
    }
  ]
}
