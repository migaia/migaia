import { defineDerive } from '@migaia/part-host'

const wrong: number = 'text'

export default defineDerive({ id: 'wrong@1', compute: () => wrong })
