import { readFileSync } from 'node:fs'
import { helper } from './helper.ts'
import { defineEffect } from '@migaia/part-host'

export default defineEffect({ id: 'reader@1', run: () => void readFileSync(helper) })
