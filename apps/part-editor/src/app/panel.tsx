import type { IDescriptor, IIndexedNode, IIssue, IJsonPatchOperation } from '@migaia/part-contract'
import type { ReactNode } from 'react'
import { pointerKey, setFacetOps } from './document.ts'
import { Control, eventNames, isStateBinding, propFields, type IField } from './schema-form.ts'
import type { EditorStore } from './store.ts'

/** Props of the property panel. */
type IPanelProps = {
  readonly store: EditorStore
  readonly entry: IIndexedNode
  readonly issues: readonly IIssue[]
}

/** Props of one field editor. */
type IFieldProps = {
  readonly field: IField
  readonly value: unknown
  readonly path: string
  readonly issues: readonly IIssue[]
  readonly onChange: (operations: IJsonPatchOperation[]) => void
}

/** Value of a text or number input as the prop value; empty text removes the prop. */
function inputValue(field: IField, text: string): unknown {
  if (text === '') return undefined
  return field.control === Control.number ? Number(text) : text
}

/** Operations writing `value` at `path` (an existing object member); `undefined` removes it. */
function writeOps(path: string, value: unknown, before: unknown): IJsonPatchOperation[] {
  if (value === undefined) return before === undefined ? [] : [{ op: 'remove', path }]
  return [{ op: 'add', path, value }]
}

/** Issues shown next to a field: those whose path names the field key. */
function fieldIssues(issues: readonly IIssue[], key: string): IIssue[] {
  return issues.filter(
    (issue) => issue.path.split('/').includes(key) || issue.path.endsWith(`.${key}`)
  )
}

/** List editor: one text input per item, with add and remove. */
function ListEditor(props: IFieldProps): ReactNode {
  /** Items. */
  const items = Array.isArray(props.value) ? (props.value as unknown[]) : []
  return (
    <div data-list={props.field.key}>
      {items.map((item, index) => (
        <div className="field" key={index}>
          <input
            value={typeof item === 'string' ? item : JSON.stringify(item)}
            onChange={(event) =>
              props.onChange([
                { op: 'replace', path: `${props.path}/${index}`, value: event.target.value }
              ])
            }
          />
          <button
            type="button"
            onClick={() => props.onChange([{ op: 'remove', path: `${props.path}/${index}` }])}
          >
            −
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          props.onChange(
            Array.isArray(props.value)
              ? [{ op: 'add', path: `${props.path}/-`, value: '' }]
              : [{ op: 'add', path: props.path, value: [''] }]
          )
        }
      >
        +
      </button>
    </div>
  )
}

/** Editor of one field; a group renders its own fields nested. */
function FieldEditor(props: IFieldProps): ReactNode {
  /** Field key. */
  const key = props.field.key
  /** Whether the value is a state binding. */
  const bound = isStateBinding(props.value)
  /** Control of the value. */
  let control: ReactNode
  if (bound)
    control = (
      <input
        data-binding={key}
        value={(props.value as { $state: string }).$state}
        onChange={(event) =>
          props.onChange([{ op: 'add', path: props.path, value: { $state: event.target.value } }])
        }
      />
    )
  else if (props.field.control === Control.checkbox)
    control = (
      <input
        type="checkbox"
        data-field={key}
        checked={props.value === true}
        onChange={(event) =>
          props.onChange([{ op: 'add', path: props.path, value: event.target.checked }])
        }
      />
    )
  else if (props.field.control === Control.select)
    control = (
      <select
        data-field={key}
        value={typeof props.value === 'string' ? props.value : ''}
        onChange={(event) =>
          props.onChange(
            writeOps(
              props.path,
              event.target.value === '' ? undefined : event.target.value,
              props.value
            )
          )
        }
      >
        <option value="" />
        {(props.field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  else if (props.field.control === Control.group)
    control = (
      <fieldset data-group={key}>
        {(props.field.fields ?? []).map((child) => (
          <FieldEditor
            key={child.key}
            field={child}
            value={(props.value as Record<string, unknown> | undefined)?.[child.key]}
            path={`${props.path}/${pointerKey(child.key)}`}
            issues={props.issues}
            onChange={props.onChange}
          />
        ))}
      </fieldset>
    )
  else if (props.field.control === Control.list) control = <ListEditor {...props} />
  else
    control = (
      <input
        data-field={key}
        type={props.field.control === Control.number ? 'number' : 'text'}
        value={
          props.value === undefined
            ? ''
            : typeof props.value === 'string' || typeof props.value === 'number'
              ? String(props.value)
              : JSON.stringify(props.value)
        }
        onChange={(event) =>
          props.onChange(
            writeOps(props.path, inputValue(props.field, event.target.value), props.value)
          )
        }
      />
    )
  return (
    <div className="field">
      <label>{key}</label>
      {control}
      <label>
        <input
          type="checkbox"
          data-bind-toggle={key}
          checked={bound}
          onChange={(event) =>
            props.onChange([
              { op: 'add', path: props.path, value: event.target.checked ? { $state: '' } : '' }
            ])
          }
        />
        $state
      </label>
      {fieldIssues(props.issues, key).map((issue) => (
        <span className="issue" data-field-issue={issue.rule} key={issue.rule}>
          {issue.rule}
        </span>
      ))}
    </div>
  )
}

/** Effect ids the handler selects offer. */
function effectIds(descriptors: readonly IDescriptor[]): string[] {
  return descriptors
    .filter((descriptor) => descriptor.kind === 'effect')
    .map((descriptor) => descriptor.id)
}

/**
 * Property panel of one node: props fields from the part descriptor (`editor` hints and props
 * schema), each switchable to a `$state` binding, the events with effect handlers, and the node's
 * issues with their fix buttons.
 */
export function PropertyPanel(props: IPanelProps): ReactNode {
  /** Node facets. */
  const facets =
    (props.entry.node as { facets?: Record<string, Record<string, unknown>> }).facets ?? {}
  /** Part descriptor. */
  const descriptor = props.store.descriptor(props.entry.node.tag)
  /** Props of the node. */
  const values = facets.props ?? {}
  /** Events of the node. */
  const events = (facets.events ?? {}) as Record<string, { handler?: string }>
  return (
    <div data-panel={props.entry.address}>
      <h3>
        {props.entry.node.tag} · {props.entry.address}
      </h3>
      {props.issues.map((issue) => (
        <div className="issue" data-issue={issue.rule} key={`${issue.rule}|${issue.path}`}>
          {issue.rule}: {issue.messageKey}
          {issue.fix === undefined ? null : (
            <button type="button" data-fix={issue.rule} onClick={() => props.store.fix(issue)}>
              Fix
            </button>
          )}
        </div>
      ))}
      {propFields(descriptor, values).map((field) => (
        <FieldEditor
          key={field.key}
          field={field}
          value={values[field.key]}
          path={`${props.entry.pointer}/facets/props/${pointerKey(field.key)}`}
          issues={props.issues}
          onChange={(operations) =>
            props.store.edit([...groupParents(props.entry, facets, 'props'), ...operations])
          }
        />
      ))}
      <h4>Aria</h4>
      {ariaFields(facets.aria ?? {}).map((field) => (
        <FieldEditor
          key={field.key}
          field={field}
          value={(facets.aria ?? {})[field.key]}
          path={`${props.entry.pointer}/facets/aria/${pointerKey(field.key)}`}
          issues={props.issues}
          onChange={(operations) =>
            props.store.edit([...groupParents(props.entry, facets, 'aria'), ...operations])
          }
        />
      ))}
      <h4>Events</h4>
      {eventNames(descriptor).map((name) => (
        <div className="field" key={name}>
          <label>{name}</label>
          <select
            data-event={name}
            value={events[name]?.handler ?? ''}
            onChange={(event) =>
              props.store.edit(
                setFacetOps(
                  props.entry.node,
                  props.entry.pointer,
                  'events',
                  name,
                  event.target.value === '' ? undefined : { handler: event.target.value }
                )
              )
            }
          >
            <option value="" />
            {effectIds(props.store.descriptors).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

/** Aria fields: `label` always, plus every aria key the node has. */
function ariaFields(aria: Readonly<Record<string, unknown>>): IField[] {
  return [...new Set(['label', ...Object.keys(aria)])].map((key) => ({
    key,
    control: Control.text
  }))
}

/** Operations creating `facets` and `facets.<group>` when the node lacks them. */
function groupParents(
  entry: IIndexedNode,
  facets: Readonly<Record<string, unknown>>,
  group: string
): IJsonPatchOperation[] {
  /** Creation operations. */
  const parents: IJsonPatchOperation[] = []
  if ((entry.node as { facets?: unknown }).facets === undefined)
    parents.push({ op: 'add', path: `${entry.pointer}/facets`, value: {} })
  if (facets[group] === undefined)
    parents.push({ op: 'add', path: `${entry.pointer}/facets/${group}`, value: {} })
  return parents
}
