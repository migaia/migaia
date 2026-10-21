import type { ICaseDoc, IText } from './contract.js'

/** Pairs localized reader explanations with public, independently runnable examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Observable collection tasks with deterministic output and explicit observer lifetimes. */
export const storeIndexedCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  ObservableObject: [
    {
      title: t(
        'Observe one field and read another without subscribing',
        '只订阅一个字段并旁读其他字段'
      ),
      problem: t(
        'A profile view renders a name while checking age for a local decision. Changing age should not rerun the name view; changing the name should.\n\nSubscribing to one whole-object signal couples every field to the same update. An incidental tracked read of age also adds a dependency the view never intended to own.\n\nUse ObservableObject.get for the field to track and peek for the untracked read. Install reactive directly; schedulerStrategy is its Runtime option, set here to run effects synchronously.',
        '资料视图显示姓名，同时读取年龄作本地判断；修改年龄不应重新运行姓名视图，修改姓名才需要更新。\n\n订阅整个对象信号会把所有字段绑到同一次更新；无意中追踪年龄读取，也会给视图增加本来不需要的依赖。\n\n用 `ObservableObject.get` 订阅所需字段，用 `peek` 旁读其他字段；直接安装 `@migaia/reactive`，本例的 `schedulerStrategy` 是运行时选项，用同步执行让输出顺序确定。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableObject } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst user = new ObservableObject({ name: 'Ada', age: 30 }, runtime)\nconst seen: string[] = []\nconst watch = runtime.effect(() => { seen.push(user.get('name')); user.peek('age') })\nuser.set('age', 31)\nuser.set('name', 'Grace')\nconsole.log(JSON.stringify(seen))\nwatch.dispose()\nuser.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableObject } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst user = new ObservableObject({ name: '艾达', age: 30 }, runtime)\nconst seen: string[] = []\nconst watch = runtime.effect(() => { seen.push(user.get('name')); user.peek('age') })\nuser.set('age', 31)\nuser.set('name', '格蕾丝')\nconsole.log(JSON.stringify(seen))\nwatch.dispose()\nuser.dispose()"
      ),
      result: t(
        'Prints `["Ada","Grace"]`. The age write adds no observation; the name write appends exactly one new value.\n\nOnly tracked get reads subscribe to that key; peek never tracks. Object.has and keys track the whole key structure instead. The supplied Runtime is borrowed, and observers and collection are explicitly disposed.',
        '输出 `["艾达","格蕾丝"]`；年龄写入没有新增观察记录，姓名写入只追加一个新值。\n\n只有追踪上下文中的 `get` 才订阅该键，`peek` 始终不追踪；`Object.has` 与 `keys` 则订阅整组键的结构，本例借用运行时，并显式释放观察者与集合。'
      )
    },
    {
      title: t(
        'Keep a previous top-level snapshot without assuming a deep copy',
        '保留旧顶层快照并看清浅复制边界'
      ),
      problem: t(
        'A history panel needs an earlier record of top-level field assignments. It also needs to know whether editing a nested object changes that earlier record.\n\nKeeping the backing object loses history when fields are reassigned. Freezing only its outer shape does not make referenced nested objects immutable.\n\nObservableObject.snapshot caches a shallow-frozen null-prototype object until a collection revision changes. Keep that result for earlier top-level values; copy nested application data separately when needed.',
        '历史面板需要保留此前顶层字段的值，也需要知道修改嵌套对象是否会改变那份旧记录。\n\n直接保留底层对象引用，会在字段重新赋值后丢失历史；仅冻结外层结构，也不会让引用到的嵌套对象变成不可变数据。\n\n`ObservableObject.snapshot` 返回浅冻结、空原型的对象，并在集合修订变化前复用缓存；它能保留旧顶层值，需要独立的嵌套数据时仍须由应用复制。'
      ),
      example: t(
        "import { ObservableObject } from '@migaia/store-indexed'\n\nconst nested = { visits: 1 }\nconst user = new ObservableObject({ count: 1, nested })\nconst first = user.snapshot()\nconsole.log(Object.isFrozen(first), Object.getPrototypeOf(first) === null, first === user.snapshot())\nuser.set('count', 2)\nconst second = user.snapshot()\nconsole.log(first.count, second.count, first === second)\nnested.visits = 9\nconsole.log(first.nested.visits, second.nested.visits)\nuser.dispose()\nconsole.log(first.count)",
        "import { ObservableObject } from '@migaia/store-indexed'\n\nconst nested = { visits: 1 }\nconst user = new ObservableObject({ count: 1, nested })\nconst first = user.snapshot()\nconsole.log(Object.isFrozen(first), Object.getPrototypeOf(first) === null, first === user.snapshot())\nuser.set('count', 2)\nconst second = user.snapshot()\nconsole.log(first.count, second.count, first === second)\nnested.visits = 9\nconsole.log(first.nested.visits, second.nested.visits)\nuser.dispose()\nconsole.log(first.count)"
      ),
      result: t(
        'Prints `true true true`, `1 2 false`, `9 9`, and `1`. An unchanged revision reuses one frozen result; a later assignment creates another, while both retain the same nested object.\n\nThe snapshot remains readable after collection disposal. Its freeze is shallow and does not provide deep history. Omitting Runtime uses defaultRuntime; omitting collection options uses no mutationGuard and the class debugName.',
        '逐行输出 `true true true`、`1 2 false`、`9 9`、`1`；修订未变时复用同一冻结结果，顶层赋值后产生新快照，但两者仍引用同一个嵌套对象。\n\n集合释放后快照仍可读取；浅冻结不提供嵌套数据的历史版本，省略运行时时使用 `defaultRuntime`，省略集合选项时不设置 `mutationGuard`，诊断名使用类名。'
      )
    }
  ],
  ObservableArray: [
    {
      title: t('Separate one row index from the list length', '分开观察一行下标与列表长度'),
      problem: t(
        'A table watches its first row and shows a row count. Updating another row should affect neither observation; appending should update only the count.\n\nWatching an entire array treats every edit as a list change. Assuming an index is a stable record ID also breaks when removing the first item moves every later value.\n\nObservableArray.at tracks an index, while length tracks structure. Use a directly installed reactive Runtime; its synchronous schedulerStrategy makes the observer counts explicit here.',
        '表格观察第一行并显示总行数；修改其他行不应影响这两处观察，追加行则只需更新数量。\n\n观察整个数组会把每次编辑都当成列表变化；把下标当作稳定记录 ID，也会在删除首项、后续值向前移动时出错。\n\n`ObservableArray.at` 订阅下标，`length` 订阅结构；本例直接安装并传入 `@migaia/reactive` 的运行时，用其同步 `schedulerStrategy` 明确展示观察次数。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableArray } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst rows = new ObservableArray([10, 20], runtime)\nlet indexRuns = 0\nlet lengthRuns = 0\nconst indexWatch = runtime.effect(() => { rows.at(0); indexRuns += 1 })\nconst lengthWatch = runtime.effect(() => { void rows.length; lengthRuns += 1 })\nrows.set(1, 21)\nconsole.log(indexRuns, lengthRuns)\nrows.set(0, 11)\nconsole.log(indexRuns, lengthRuns)\nrows.push(30)\nconsole.log(indexRuns, lengthRuns)\nrows.splice(0, 1)\nconsole.log(indexRuns, lengthRuns, rows.at(0))\nindexWatch.dispose()\nlengthWatch.dispose()\nrows.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableArray } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst rows = new ObservableArray([10, 20], runtime)\nlet indexRuns = 0\nlet lengthRuns = 0\nconst indexWatch = runtime.effect(() => { rows.at(0); indexRuns += 1 })\nconst lengthWatch = runtime.effect(() => { void rows.length; lengthRuns += 1 })\nrows.set(1, 21)\nconsole.log(indexRuns, lengthRuns)\nrows.set(0, 11)\nconsole.log(indexRuns, lengthRuns)\nrows.push(30)\nconsole.log(indexRuns, lengthRuns)\nrows.splice(0, 1)\nconsole.log(indexRuns, lengthRuns, rows.at(0))\nindexWatch.dispose()\nlengthWatch.dispose()\nrows.dispose()"
      ),
      result: t(
        'Prints `1 1`, `2 1`, `2 2`, then `3 3 21`. A sibling edit is ignored, index 0 changes independently, append changes length, and splice moves 21 into the watched position.\n\nIndices identify positions, not entities. set accepts only existing nonnegative integer positions; at also accepts negative integers. Every displayed count includes the initial effect run, and the Runtime is borrowed.',
        '逐行输出 `1 1`、`2 1`、`2 2`、`3 3 21`；旁边一行的修改被忽略，下标 `0` 独立更新，追加只更新长度，删除首项后 `21` 移入观察位置。\n\n下标表示位置，不表示实体；`set` 只接受已有范围内的非负整数，`at` 还接受负整数，次数均包括首次运行观察函数，本例只借用运行时。'
      )
    },
    {
      title: t(
        'Preserve the old array when replacement input fails',
        '替换输入读取失败时保留旧数组'
      ),
      problem: t(
        'A streamed replacement yields one row and then fails. The visible collection should keep its complete previous contents rather than show half the new input.\n\nClearing the old list before consuming an iterator commits too early. Pushing each incoming item also exposes partial results if the next iterator step throws.\n\nObservableArray.replace materializes its whole iterable before committing. This example uses a real generator that throws after one value, then supplies a valid replacement.',
        '替换数据源先产出一行，随后读取失败；界面集合应保留完整旧内容，不能只显示读到一半的新输入。\n\n在消费迭代器前清空旧列表，等于过早提交；每拿到一项就追加，也会在下一次迭代抛错时暴露半份结果。\n\n`ObservableArray.replace` 先完整读取可迭代输入，再提交替换；本例让真实生成器产出一项后抛错，随后再传入合法替换值。'
      ),
      example: t(
        "import { ObservableArray } from '@migaia/store-indexed'\n\nconst rows = new ObservableArray([1, 2])\nconst original = new Error('input interrupted')\nfunction* incoming(): Generator<number> {\n  yield 3\n  throw original\n}\ntry {\n  rows.replace(incoming())\n} catch (error) {\n  if (!(error instanceof Error) || !('code' in error)) throw error\n  console.log(error.code, error.cause === original)\n}\nconsole.log(JSON.stringify(rows.snapshot()))\nrows.replace([4, 5])\nconsole.log(JSON.stringify(rows.snapshot()))\nrows.dispose()",
        "import { ObservableArray } from '@migaia/store-indexed'\n\nconst rows = new ObservableArray([1, 2])\nconst original = new Error('输入中断')\nfunction* incoming(): Generator<number> {\n  yield 3\n  throw original\n}\ntry {\n  rows.replace(incoming())\n} catch (error) {\n  if (!(error instanceof Error) || !('code' in error)) throw error\n  console.log(error.code, error.cause === original)\n}\nconsole.log(JSON.stringify(rows.snapshot()))\nrows.replace([4, 5])\nconsole.log(JSON.stringify(rows.snapshot()))\nrows.dispose()"
      ),
      result: t(
        'Prints `INVALID_OPTION true`, `[1,2]`, and `[4,5]`. The iterator error stays on cause, no partial replacement is committed, and a later valid input succeeds.\n\nInput preparation is atomic for this collection; it does not undo effects performed by the iterator itself. Replacement is shallow, strings are accepted as character iterables, and equal-length input still requires value comparisons.',
        '逐行输出 `INVALID_OPTION true`、`[1,2]`、`[4,5]`；迭代错误保留在 `cause`，失败输入没有提交半份替换，之后合法输入仍能成功。\n\n原子准备只保证当前集合不被部分修改，不撤销迭代器自身的副作用；替换保留嵌套值引用，也接受按字符迭代的字符串，等长输入仍须比较各项值。'
      )
    }
  ],
  ObservableMap: [
    {
      title: t('Observe key order separately from changing values', '分别观察键顺序与值的变化'),
      problem: t(
        'A navigation list needs map keys, while a summary displays values. Updating an existing value should refresh the summary without rebuilding the key list.\n\nOne whole-map subscription cannot distinguish value edits from structural changes. Comparing membership alone also misses a replacement that reorders the same entries.\n\nObservableMap.keys tracks structure and valuesArray tracks value iteration. replace also checks insertion order. Install reactive directly; the example selects synchronous Runtime scheduling for exact counts.',
        '导航列表需要映射的键，摘要区域需要值；更新已有值时，应刷新摘要，而不必重建键列表。\n\n订阅整个映射无法区分值修改与结构变化；只比较成员是否相同，又会漏掉同一批条目调整插入顺序的替换。\n\n`ObservableMap.keys` 订阅结构，`valuesArray` 订阅值迭代，`replace` 也检查插入顺序；直接安装 `@migaia/reactive`，本例选用同步运行时调度来展示准确次数。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableMap } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst values = new ObservableMap<string, number>([['a', 1], ['b', 2]], runtime)\nlet keyRuns = 0\nlet valueRuns = 0\nconst keysWatch = runtime.effect(() => { values.keys(); keyRuns += 1 })\nconst valuesWatch = runtime.effect(() => { values.valuesArray(); valueRuns += 1 })\nvalues.set('a', 10)\nconsole.log(keyRuns, valueRuns)\nvalues.replace([['b', 2], ['a', 10]])\nconsole.log(keyRuns, valueRuns, JSON.stringify(values.keys()), JSON.stringify(values.valuesArray()))\nvalues.replace([['b', 2], ['a', 10]])\nconsole.log(keyRuns, valueRuns)\nkeysWatch.dispose()\nvaluesWatch.dispose()\nvalues.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableMap } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst values = new ObservableMap<string, number>([['a', 1], ['b', 2]], runtime)\nlet keyRuns = 0\nlet valueRuns = 0\nconst keysWatch = runtime.effect(() => { values.keys(); keyRuns += 1 })\nconst valuesWatch = runtime.effect(() => { values.valuesArray(); valueRuns += 1 })\nvalues.set('a', 10)\nconsole.log(keyRuns, valueRuns)\nvalues.replace([['b', 2], ['a', 10]])\nconsole.log(keyRuns, valueRuns, JSON.stringify(values.keys()), JSON.stringify(values.valuesArray()))\nvalues.replace([['b', 2], ['a', 10]])\nconsole.log(keyRuns, valueRuns)\nkeysWatch.dispose()\nvaluesWatch.dispose()\nvalues.dispose()"
      ),
      result: t(
        'Prints `1 2`, `2 3 ["b","a"] [2,10]`, and `2 3`. Updating a changes only the values observer; reordering updates both once; repeating identical ordered content updates neither.\n\nsize also tracks structure and can rerun on reorder even when its numeric value stays equal. Map.has shares the selected value cell, so changing that key’s value can also rerun has; it is not a separate membership-only signal.',
        '逐行输出 `1 2`、`2 3 ["b","a"] [2,10]`、`2 3`；修改 `a` 只更新值观察者，重排分别更新两者一次，重复相同有序内容则都不更新。\n\n`size` 也订阅结构，重排时即使数量不变仍可能重跑；`Map.has` 复用所选键的值信号，因此同键换值也可能让它重跑，它不是独立的仅成员存在性信号。'
      )
    }
  ],
  ObservableSet: [
    {
      title: t(
        'Watch one selected member and release the collection independently',
        '只观察一个选中成员并独立释放集合'
      ),
      problem: t(
        'A selection badge watches item a while other items are selected. Closing that badge’s collection must not shut down the Runtime used by other application state.\n\nWatching the entire Set reruns the badge for every unrelated selection. Giving a borrowed Runtime the same disposal lifetime as one collection also breaks its other users.\n\nObservableSet.has tracks one member. Dispose its observer and collection explicitly; the supplied Runtime remains usable. Install reactive directly, with synchronous Runtime scheduling chosen only for this example.',
        '选择标记只关心条目 `a`，用户还会选择其他条目；关闭这份集合，也不能关闭其他应用状态共用的运行时。\n\n观察整个 `Set` 会在每次无关选择时重跑标记；把借用的运行时和单个集合一起销毁，又会破坏运行时的其他使用者。\n\n`ObservableSet.has` 订阅单个成员，显式释放观察者和集合后，传入的运行时仍可使用；直接安装 `@migaia/reactive`，同步运行时调度仅用于本例展示。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableSet } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst selected = new ObservableSet(['a'], runtime)\nlet runs = 0\nlet present = false\nconst watch = runtime.effect(() => { present = selected.has('a'); runs += 1 })\nselected.add('b')\nconsole.log(runs, present)\nselected.delete('a')\nconsole.log(runs, present)\nselected.add('a')\nconsole.log(runs, present)\nwatch.dispose()\nselected.dispose()\nselected.dispose()\nconst count = runtime.signal(1)\ncount.value = 2\nconsole.log(selected.disposed, count.value)\ncount.dispose()",
        "import { createRuntime } from '@migaia/reactive'\nimport { ObservableSet } from '@migaia/store-indexed'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst selected = new ObservableSet(['a'], runtime)\nlet runs = 0\nlet present = false\nconst watch = runtime.effect(() => { present = selected.has('a'); runs += 1 })\nselected.add('b')\nconsole.log(runs, present)\nselected.delete('a')\nconsole.log(runs, present)\nselected.add('a')\nconsole.log(runs, present)\nwatch.dispose()\nselected.dispose()\nselected.dispose()\nconst count = runtime.signal(1)\ncount.value = 2\nconsole.log(selected.disposed, count.value)\ncount.dispose()"
      ),
      result: t(
        'Prints `1 true`, `2 false`, `3 true`, and `true 2`. Adding b does not rerun a’s observer; deleting and restoring a do; after idempotent collection disposal, a new Runtime signal still works.\n\nThe collection owns its internal signals, not the Runtime or nested application objects. Dispose observers first. Later data access through the disposed collection throws COLLECTION_DISPOSED; disposed itself remains readable.',
        '逐行输出 `1 true`、`2 false`、`3 true`、`true 2`；添加 `b` 不重跑 `a` 的观察者，删除与恢复 `a` 会更新，幂等释放集合后，新建的运行时信号仍能使用。\n\n集合拥有内部信号，不拥有运行时或嵌套应用对象；先释放观察者，集合释放后的数据访问会抛 `COLLECTION_DISPOSED`，`disposed` 状态本身仍可读取。'
      )
    }
  ]
}
