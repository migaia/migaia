import { createRuntime } from '@migai/store/kernel'
import { createStore } from '@migai/store/store'

const runtime = createRuntime()
const state = createStore({ count: 0 }, { runtime })

document.documentElement.dataset.storeCount = String(state.count)
