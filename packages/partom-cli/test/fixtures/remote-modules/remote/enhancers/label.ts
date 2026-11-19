// Remote enhancer: gives buttons an accessible label.
import { defineEnhancer } from '@migaia/part-host'

export default defineEnhancer({
  id: 'label@1',
  targets: ['button'],
  transform: (config) => ({ ...config, aria: { ...config.aria, label: 'Action' } })
})
