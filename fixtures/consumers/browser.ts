import { createRuntime } from '@migaia/store/kernel'
import { createStore } from '@migaia/store/store'

const runtime = createRuntime()
const state = createStore({ count: 0 }, { runtime })

document.documentElement.dataset.storeCount = String(state.count)
