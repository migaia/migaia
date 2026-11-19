import { defineEnhancer } from '@migaia/part-host'

export default defineEnhancer({
  id: 'random@1',
  targets: ['button'],
  transform: (config) => ({ ...config, data: { ...config.data, seed: Math.random() } })
})
