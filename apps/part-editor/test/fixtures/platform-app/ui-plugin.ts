// Hand-written assembly of the parts `partom extract components/ui/*.tsx --out src/parts` generates.
import { definePartPlugin } from '@migaia/part-host'
import { buttonBinding, buttonPart } from './src/parts/button.part.ts'
import { checkboxBinding, checkboxPart } from './src/parts/checkbox.part.ts'
import dataTablePlugin from './src/parts/data-table.part.tsx'
import formPlugin from './src/parts/form.part.tsx'
import { inputBinding, inputPart } from './src/parts/input.part.ts'
import { selectContentBinding, selectContentPart } from './src/parts/select-content.part.ts'
import { selectItemBinding, selectItemPart } from './src/parts/select-item.part.ts'
import { selectTriggerBinding, selectTriggerPart } from './src/parts/select-trigger.part.ts'
import { selectValueBinding, selectValuePart } from './src/parts/select-value.part.ts'
import { selectBinding, selectPart } from './src/parts/select.part.ts'
import { tableBodyBinding, tableBodyPart } from './src/parts/table-body.part.ts'
import { tableCellBinding, tableCellPart } from './src/parts/table-cell.part.ts'
import { tableHeadBinding, tableHeadPart } from './src/parts/table-head.part.ts'
import { tableHeaderBinding, tableHeaderPart } from './src/parts/table-header.part.ts'
import { tableRowBinding, tableRowPart } from './src/parts/table-row.part.ts'
import { tablePart, tableBinding } from './src/parts/table.part.ts'

/** Wrapped shadcn components. */
const wrapped = definePartPlugin({
  name: 'ui',
  parts: [
    buttonPart,
    checkboxPart,
    inputPart,
    selectPart,
    selectTriggerPart,
    selectValuePart,
    selectContentPart,
    selectItemPart,
    tablePart,
    tableHeaderPart,
    tableBodyPart,
    tableHeadPart,
    tableRowPart,
    tableCellPart
  ],
  implementations: [
    buttonBinding,
    checkboxBinding,
    inputBinding,
    selectBinding,
    selectTriggerBinding,
    selectValueBinding,
    selectContentBinding,
    selectItemBinding,
    tableBinding,
    tableHeaderBinding,
    tableBodyBinding,
    tableHeadBinding,
    tableRowBinding,
    tableCellBinding
  ]
})

/** Every plugin the component extraction produced. */
export const uiPlugins = [wrapped, formPlugin, dataTablePlugin] as const
