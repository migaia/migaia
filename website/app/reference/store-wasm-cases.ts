import type { ICaseDoc } from './contract.js'

/** Real native-memory examples; each owns its Store and uses only public entries. */
export const storeWasmCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  ensureWasm: [
    {
      title: {
        en: 'Share one readiness Promise before creating fields',
        zh: '创建字段前复用同一个就绪 Promise'
      },
      problem: {
        en: 'Several startup paths need WASM fields and may ask for readiness at the same time.\n\nStarting a new initialization Promise on every read can give each caller a different readiness token, even after loading succeeds.\n\nInitialize the native module from its published file in Node, then call ensureWasm() without arguments; it keeps one Promise while pending and after success.',
        zh: '多个启动入口都要创建 WASM 字段，可能同时询问模块是否已经就绪。\n\n每次查询都临时包装初始化 Promise，会让调用方拿到不同的就绪凭据，即使模块早已加载成功。\n\nNode 中先从发布的文件初始化原生模块，再调用无参数的 `ensureWasm()`；等待中及成功后，它都会复用同一个 Promise。'
      },
      example: {
        en: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm } from '@migaia/store-wasm'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nconst first = ensureWasm()\nconst second = ensureWasm()\nconsole.log(first === second)\nconst memory = await first\nconsole.log(memory instanceof WebAssembly.Memory)\nconsole.log(first === ensureWasm())",
        zh: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm } from '@migaia/store-wasm'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nconst first = ensureWasm()\nconst second = ensureWasm()\nconsole.log(first === second)\nconst memory = await first\nconsole.log(memory instanceof WebAssembly.Memory)\nconsole.log(first === ensureWasm())"
      },
      result: {
        en: 'The output is true, true, true on separate lines: both pending calls match, the resolved value is native memory, and the settled call still matches.\n\nThe Promise establishes readiness and does not allocate fields or transfer memory ownership. Failure clears its attempt cache; synchronous field creation must still wait for a successful call.',
        zh: '输出三行 `true`：两次等待中的调用相同，结果是原生内存，成功后的调用仍返回原 Promise。\n\n它只建立就绪条件，不分配字段，也不移交共享内存的所有权；初始化失败会清空尝试缓存，同步创建字段仍须等待一次成功的调用。'
      }
    }
  ],
  number: [
    {
      title: {
        en: 'Keep a numeric field usable after native memory grows',
        zh: '原生内存增长后继续读写数值字段'
      },
      problem: {
        en: 'Other WASM allocations can grow linear memory while an existing numeric field remains in use.\n\nA DataView kept against the old buffer becomes detached, so hand-written readers and writers can fail after growth.\n\nPut number() in createStore after readiness; the field refreshes its view of current memory and the Store owns its cleanup.',
        zh: '其他 WASM 分配可能在数值字段仍被使用时增长线性内存。\n\n如果手写读写逻辑一直保存旧缓冲区上的 DataView，内存增长后视图会失效，原本正常的字段也就无法继续访问。\n\n就绪后把无参数的 `number()` 交给 `createStore`；字段会读取当前内存视图，清理由 Store 统一负责。'
      },
      example: {
        en: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, number } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nconst memory = await ensureWasm()\nconst store = createStore({ score: number() })\nconst field = store.score\ntry {\n  console.log(field.value)\n  field.value = 12.5\n  const before = memory.buffer\n  memory.grow(1)\n  console.log(memory.buffer !== before, field.value)\n  field.value = 19\n  console.log(field.value)\n} finally {\n  await store.$dispose()\n}\nconsole.log(field.disposed)\ntry {\n  console.log(field.value)\n} catch (error) {\n  console.log((error as { code?: string }).code)\n}",
        zh: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, number } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nconst memory = await ensureWasm()\nconst store = createStore({ score: number() })\nconst field = store.score\ntry {\n  console.log(field.value)\n  field.value = 12.5\n  const before = memory.buffer\n  memory.grow(1)\n  console.log(memory.buffer !== before, field.value)\n  field.value = 19\n  console.log(field.value)\n} finally {\n  await store.$dispose()\n}\nconsole.log(field.disposed)\ntry {\n  console.log(field.value)\n} catch (error) {\n  console.log((error as { code?: string }).code)\n}"
      },
      result: {
        en: 'The lines are 0, true 12.5, 19, true, FIELD_DISPOSED: the buffer changes while the stored value survives, later writes work, and Store disposal closes the retained field.\n\nA numeric field starts at 0 and uses f64 storage. This demonstrates ordinary memory growth, not recovery from a native trap; a poisoned shared instance requires restarting its owner.',
        zh: '依次输出 `0`、`true 12.5`、`19`、`true`、`FIELD_DISPOSED`：缓冲区已更换，原值仍在，新值可写，Store 释放后保留的字段引用也已关闭。\n\n数值初始值为 `0`，按 f64 存储。这里证明正常内存增长后的读写，不代表能从原生陷阱恢复；共享实例中毒后需要重启其拥有者。'
      }
    }
  ],
  string: [
    {
      title: {
        en: 'Reject a UTF-8 overflow without truncating the old value',
        zh: '按 UTF-8 容量拒绝超长写入并保留原值'
      },
      problem: {
        en: 'A label fits a character limit but exceeds its fixed byte budget once encoded for WASM storage.\n\nCounting characters underestimates multibyte text, while truncating encoded bytes can split a character and silently replace valid data.\n\nUse string(6) for a six-byte capacity, overriding the default 256; an oversized assignment fails before the field commits any replacement.',
        zh: '标签没有超过字符数限制，编码后却放不进 WASM 字段预留的字节空间。\n\n只数字符会低估多字节文本的容量，直接截取编码字节又可能切断一个字符，悄悄破坏原本有效的内容。\n\n用 `string(6)` 把默认 `256` 字节改为六字节容量；超容量赋值会在提交新值之前失败。'
      },
      example: {
        en: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, string } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst store = createStore({ title: string(6) })\ntry {\n  store.title.value = 'ééé'\n  console.log(store.title.value, new TextEncoder().encode(store.title.value).length)\n  try {\n    store.title.value = 'éééé'\n  } catch (error) {\n    console.log((error as { code?: string }).code)\n  }\n  console.log(store.title.value)\n} finally {\n  await store.$dispose()\n}",
        zh: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, string } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst store = createStore({ title: string(6) })\ntry {\n  store.title.value = '你好'\n  console.log(store.title.value, new TextEncoder().encode(store.title.value).length)\n  try {\n    store.title.value = '你好呀'\n  } catch (error) {\n    console.log((error as { code?: string }).code)\n  }\n  console.log(store.title.value)\n} finally {\n  await store.$dispose()\n}"
      },
      result: {
        en: 'The output is ééé 6, INVALID_OPTION, then ééé: three accented characters consume six bytes and the longer assignment leaves that value intact.\n\nCapacity counts TextEncoder UTF-8 bytes and stays fixed. Overflow neither truncates nor grows the field; choose a larger capacity when longer values are part of the input contract.',
        zh: '输出依次为 `你好 6`、`INVALID_OPTION`、`你好`：两个汉字占六字节，更长的赋值失败后仍读到旧值。\n\n容量按 `TextEncoder` 编码后的 UTF-8 字节数计算且不会自动增长；超容量既不截断也不扩容，业务允许更长内容时应选更大的容量。'
      }
    }
  ],
  array: [
    {
      title: {
        en: 'Track one array index and keep copied views isolated',
        zh: '独立追踪数组下标并隔离拷贝视图'
      },
      problem: {
        en: 'A view reads only one sample, but updates elsewhere in a large numeric array keep invalidating that reader.\n\nSharing one notification bucket across many indices makes unrelated readers rerun, and exposing writable native memory would bypass tracked writes.\n\nUse array(3, 1) to give each index its own bucket instead of the default 64; write through setAt and use view only for an independent copy.',
        zh: '界面只读取一个采样点，数组其他位置的变化却不断让这个读取者重新运行。\n\n多个下标共用一个通知桶时，同桶的无关读取者也会失效；若直接暴露可写原生内存，又会绕过响应式写入。\n\n用 `array(3, 1)` 把默认每桶 `64` 个下标改为逐下标追踪；通过 `setAt` 写入，`view()` 只用于取得独立拷贝。'
      },
      example: {
        en: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, array } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\nimport { createRuntime } from '@migaia/reactive'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst runtime = createRuntime()\nconst store = createStore({ samples: array(3, 1) }, { runtime })\nconst seen: number[] = []\nconst effect = runtime.effect(() => {\n  seen.push(store.samples.at(0))\n})\ntry {\n  store.samples.setAt(1, 7)\n  runtime.flush()\n  console.log(seen.join(','))\n  store.samples.setAt(0, 5)\n  runtime.flush()\n  console.log(seen.join(','))\n  const copy = store.samples.view()\n  copy[0] = 99\n  console.log(copy[0], store.samples.at(0))\n} finally {\n  effect.dispose()\n  await store.$dispose()\n}",
        zh: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, array } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\nimport { createRuntime } from '@migaia/reactive'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst runtime = createRuntime()\nconst store = createStore({ samples: array(3, 1) }, { runtime })\nconst seen: number[] = []\nconst effect = runtime.effect(() => {\n  seen.push(store.samples.at(0))\n})\ntry {\n  store.samples.setAt(1, 7)\n  runtime.flush()\n  console.log(seen.join(','))\n  store.samples.setAt(0, 5)\n  runtime.flush()\n  console.log(seen.join(','))\n  const copy = store.samples.view()\n  copy[0] = 99\n  console.log(copy[0], store.samples.at(0))\n} finally {\n  effect.dispose()\n  await store.$dispose()\n}"
      },
      result: {
        en: 'The output is 0, then 0,5, then 99 5: changing index 1 does not rerun the index-0 reader, changing index 0 does, and modifying the copy leaves the field at 5.\n\nIndices must be safe integers in [0, length); negative Array.at-style indices are unsupported. view() does not track reads or write back, and coarser buckets can invalidate neighboring readers.',
        zh: '输出为 `0`、`0,5`、`99 5`：改下标 `1` 不重跑只读下标 `0` 的观察者，改下标 `0` 才重跑；把副本改成 `99`，字段仍为 `5`。\n\n下标须为 `[0, length)` 内的安全整数，不支持 `Array.at` 的负数索引。`view()` 不追踪读取，也不回写；更粗的桶会使邻近下标的读取者一起失效。'
      }
    },
    {
      title: {
        en: 'Reject unreadable range input before changing array bytes',
        zh: '范围输入无法读取时保持数组原值'
      },
      problem: {
        en: 'A batch update reads numbers from an ArrayLike object whose accessor can fail midway through the input.\n\nWriting each number immediately after reading it leaves a partially updated field when a later accessor throws.\n\nsetRange reads the complete input before writing its half-open [lo, hi) range, so an input failure is classified without changing the existing bytes.',
        zh: '批量更新从类数组对象读取数值，其中某个访问器可能在读取到一半时抛错。\n\n边读边写会把前面的新值留在字段里，后面的访问器一失败，数组就停在只更新了一部分的状态。\n\n`setRange` 会在写入左闭右开区间 `[lo, hi)` 前读完全部输入；读取失败时附加错误身份，现有字段字节保持不变。'
      },
      example: {
        en: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, array } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst store = createStore({ samples: array(3) })\nconst failureText = 'range input cannot be read'\nconst failure = new TypeError(failureText)\nconst input: ArrayLike<number> = {\n  length: 3,\n  0: 9,\n  get 1(): number {\n    throw failure\n  },\n  2: 9\n}\ntry {\n  store.samples.setRange(0, 3, [1, 2, 3])\n  try {\n    store.samples.setRange(0, 3, input)\n  } catch (error) {\n    console.log(error === failure, (error as { code?: string }).code)\n  }\n  console.log([...store.samples.view()].join(','))\n  store.samples.setRange(0, 2, [4, 5])\n  console.log([...store.samples.view()].join(','))\n} finally {\n  await store.$dispose()\n}",
        zh: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, array } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst store = createStore({ samples: array(3) })\nconst failureText = '无法读取范围输入'\nconst failure = new TypeError(failureText)\nconst input: ArrayLike<number> = {\n  length: 3,\n  0: 9,\n  get 1(): number {\n    throw failure\n  },\n  2: 9\n}\ntry {\n  store.samples.setRange(0, 3, [1, 2, 3])\n  try {\n    store.samples.setRange(0, 3, input)\n  } catch (error) {\n    console.log(error === failure, (error as { code?: string }).code)\n  }\n  console.log([...store.samples.view()].join(','))\n  store.samples.setRange(0, 2, [4, 5])\n  console.log([...store.samples.view()].join(','))\n} finally {\n  await store.$dispose()\n}"
      },
      result: {
        en: 'The output is true INVALID_OPTION, then 1,2,3, then 4,5,3: the exact TypeError is retained, the rejected input changes nothing, and a later valid range can still be applied.\n\nvalues.length must equal hi - lo and every value must be a number. This proves admission before writes; it does not promise rollback of external accessor side effects or earlier observer notifications.',
        zh: '输出为 `true INVALID_OPTION`、`1,2,3`、`4,5,3`：原 TypeError 身份保留，失败输入没有改动字段，随后仍可正常写入有效范围。\n\n`values.length` 必须等于 `hi - lo`，所有输入值都须为数字。这里证明先读后写，不承诺撤销访问器自身的外部副作用，也不泛化为通知回滚。'
      }
    }
  ],
  record: [
    {
      title: {
        en: 'Observe one named coordinate without tracking its siblings',
        zh: '只观察一个坐标字段而不订阅其同级字段'
      },
      problem: {
        en: 'A component reads the horizontal coordinate while only the vertical coordinate changes.\n\nTracking the entire position object would rerun that reader for any property change, even when its own input stays the same.\n\nBuild a fixed record from number() descriptors; each named numeric property has its own source and is read directly as position.x rather than through .value.',
        zh: '组件只读取横坐标，纵坐标变化时却也跟着重新计算。\n\n如果把整个位置对象当作一个依赖，任何属性变化都会让读取者重跑，即使它真正使用的输入并未改变。\n\n用 `number()` 描述固定记录的字段；每个命名数字属性都有独立响应源，直接读写 `position.x`，无需再经过 `.value`。'
      },
      example: {
        en: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, record, number } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\nimport { createRuntime } from '@migaia/reactive'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst runtime = createRuntime()\nconst store = createStore({ position: record({ x: number(), y: number() }) }, { runtime })\nconst seen: number[] = []\nconst effect = runtime.effect(() => {\n  seen.push(store.position.x)\n})\ntry {\n  store.position.y = 9\n  runtime.flush()\n  console.log(seen.join(','))\n  store.position.x = 3\n  runtime.flush()\n  console.log(seen.join(','))\n  console.log(Object.keys(store.position).join(','))\n  console.log(store.position.x, store.position.y)\n} finally {\n  effect.dispose()\n  await store.$dispose()\n}",
        zh: "import { readFile } from 'node:fs/promises'\nimport initWasm from '@migaia/wasm'\nimport { ensureWasm, record, number } from '@migaia/store-wasm'\nimport { createStore } from '@migaia/store-light'\nimport { createRuntime } from '@migaia/reactive'\n\nconst url = new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))\nawait initWasm({ module_or_path: await readFile(url) })\nawait ensureWasm()\nconst runtime = createRuntime()\nconst store = createStore({ position: record({ x: number(), y: number() }) }, { runtime })\nconst seen: number[] = []\nconst effect = runtime.effect(() => {\n  seen.push(store.position.x)\n})\ntry {\n  store.position.y = 9\n  runtime.flush()\n  console.log(seen.join(','))\n  store.position.x = 3\n  runtime.flush()\n  console.log(seen.join(','))\n  console.log(Object.keys(store.position).join(','))\n  console.log(store.position.x, store.position.y)\n} finally {\n  effect.dispose()\n  await store.$dispose()\n}"
      },
      result: {
        en: 'The output is 0, then 0,3, then x,y, then 3 9: updating y leaves the x reader alone, updating x reruns it, and enumeration exposes only business keys.\n\nRecord values begin at 0. The shape is fixed and supports number() builders only; nested fields and dynamic keys are unsupported, while dispose and disposed remain reserved lifecycle names.',
        zh: '依次输出 `0`、`0,3`、`x,y`、`3 9`：改 `y` 不影响只读 `x` 的观察者，改 `x` 才重跑，枚举时只看见业务字段。\n\n记录值初始为 `0`；结构固定且只支持 `number()` 构造器，不支持嵌套字段和动态增键，`dispose`、`disposed` 保留给生命周期使用。'
      }
    }
  ]
}
