import type { IIssue } from '@migaia/part-contract'
import { useRef, useState, type ReactNode } from 'react'
import { moduleTemplate } from '../text.ts'
import type { EditorStore } from './store.ts'

/** Line of a module issue (`<name>:<line>:<column>`), or undefined. */
export function issueLine(issue: IIssue): number | undefined {
  /** Position suffix. */
  const match = /:(\d+):\d+$/.exec(issue.path)
  return match === null ? undefined : Number(match[1])
}

/** Character offset where a one-based line starts. */
function lineOffset(text: string, line: number): number {
  /** Offset found so far. */
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    /** Next line break. */
    const next = text.indexOf('\n', offset)
    if (next === -1) return text.length
    offset = next + 1
  }
  return offset
}

/** Module list with the "new module" form. */
export function ModuleList(props: { readonly store: EditorStore }): ReactNode {
  /** Name typed for a new module. */
  const [name, setName] = useState('')
  return (
    <div data-modules>
      {[...props.store.modules.values()].map((module) => (
        <div
          className="node"
          data-module={module.name}
          aria-selected={module.name === props.store.module}
          key={module.name}
          onClick={() => props.store.selectModule(module.name)}
        >
          {module.name}
          {module.source === undefined ? ' (read-only)' : ''}
          {module.dirty ? ' *' : ''}
        </div>
      ))}
      <input
        data-new-module
        placeholder="effects/name.ts"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="button"
        data-create-module
        disabled={name === ''}
        onClick={() =>
          props.store.newModule(
            name,
            moduleTemplate(`${name.replace(/^.*\//, '').replace(/\.tsx?$/, '')}@1`)
          )
        }
      >
        New module
      </button>
    </div>
  )
}

/**
 * Monospace source editor of the selected module with its save issues; clicking one selects its
 * line.
 */
export function ModuleEditor(props: {
  readonly store: EditorStore
  readonly name: string
}): ReactNode {
  /** Module. */
  const module = props.store.modules.get(props.name)
  /** Text area element. */
  const area = useRef<HTMLTextAreaElement>(null)
  if (module === undefined) return null
  /** Source text. */
  const source = module.source ?? ''
  return (
    <div data-module-editor={props.name}>
      <h3>{props.name}</h3>
      <textarea
        ref={area}
        data-module-source
        readOnly={module.source === undefined}
        spellCheck={false}
        style={{ width: '100%', height: '60vh', fontFamily: 'ui-monospace, monospace' }}
        value={source}
        onChange={(event) => props.store.editModule(props.name, event.target.value)}
      />
      {(props.store.moduleIssues.get(props.name) ?? []).map((issue) => (
        <div
          className="issue"
          data-module-issue={issue.rule}
          data-line={issueLine(issue)}
          key={`${issue.rule}|${issue.path}`}
          onClick={() => {
            area.current?.focus()
            area.current?.setSelectionRange(
              lineOffset(source, issueLine(issue) ?? 1),
              lineOffset(source, (issueLine(issue) ?? 1) + 1) - 1
            )
          }}
        >
          {issue.path} {issue.rule}: {issue.messageKey}
        </div>
      ))}
    </div>
  )
}
