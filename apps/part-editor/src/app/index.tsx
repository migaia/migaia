import type { IIndexedNode, IIssue } from '@migaia/part-contract'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CONFIG_GLOBAL } from '../text.ts'
import { moveUpOps } from './document.ts'
import { issuesByAddress } from './issues.ts'
import { ModuleEditor, ModuleList } from './modules.tsx'
import { PreviewBridge } from './preview.ts'
import { PropertyPanel } from './panel.tsx'
import { EditorStore, Phase } from './store.ts'

/** Page configuration set by the served HTML. */
const CONFIG = (globalThis as unknown as Record<string, { service: string; preview: string }>)[
  CONFIG_GLOBAL
] as {
  readonly service: string
  readonly preview: string
}

/** The page's store. */
const store = new EditorStore(CONFIG.service)

/** Bridge to the preview iframe; page reports go to the store. */
const bridge = new PreviewBridge(CONFIG.preview, {
  issues: (blueprintId, issues) => store.setPreviewIssues(blueprintId, issues),
  failed: (message) => store.previewFailed(message),
  ready: () => store.previewReady()
})
store.attachPreview(bridge)

/** Re-renders a view whenever the store changes. */
function useStore(): void {
  useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.snapshot()
  )
}

/** Token and project form. */
function LoginForm(): ReactNode {
  /** Typed token. */
  const [token, setToken] = useState('')
  /** Typed project. */
  const [project, setProject] = useState('')
  return (
    <form
      data-login
      onSubmit={(event) => {
        event.preventDefault()
        void store.login(token, project)
      }}
    >
      <input
        data-token
        placeholder="write token"
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <input
        data-project
        placeholder="project"
        value={project}
        onChange={(event) => setProject(event.target.value)}
      />
      <button type="submit">Open</button>
      <span className="issue" data-status>
        {store.status}
      </span>
    </form>
  )
}

/** Top bar: draft state, status and save. */
function Header(): ReactNode {
  return (
    <div className="status">
      <strong data-draft-state>草稿 · 基于 {store.draft?.base.tag}</strong>
      <button type="button" data-save onClick={() => void store.save()}>
        Save
      </button>
      <span data-status>{store.status}</span>
      {store.lastResult?.artifacts.map((item) => (
        <span data-result={item.key} key={item.key}>
          {item.key}: {item.status}
        </span>
      ))}
    </div>
  )
}

/** Depth of each entry from its parent chain; parents precede children in document order. */
function depths(entries: readonly IIndexedNode[]): Map<string, number> {
  /** Depth by address. */
  const depth = new Map<string, number>()
  for (const entry of entries)
    depth.set(entry.address, entry.parent === undefined ? 0 : (depth.get(entry.parent) ?? 0) + 1)
  return depth
}

/** Node tree of the selected blueprint with add, delete and move-up actions. */
function Tree(props: {
  readonly entries: readonly IIndexedNode[]
  readonly issues: Map<string, IIssue[]>
}): ReactNode {
  /** Depth by address. */
  const depth = depths(props.entries)
  /** Part tags to add. */
  const parts = store.descriptors.filter((descriptor) => descriptor.kind === 'part')
  /** Selected entry. */
  const selected = props.entries.find((entry) => entry.address === store.address)
  /** Tag chosen for a new child. */
  const [tag, setTag] = useState('')
  return (
    <div data-tree>
      {props.entries.map((entry) => (
        <div
          className="node"
          data-node={entry.address}
          aria-selected={entry.address === store.address}
          key={entry.address}
          style={{ paddingLeft: (depth.get(entry.address) ?? 0) * 12 }}
          onClick={() => store.selectAddress(entry.address)}
        >
          {entry.node.id ?? entry.address} <small>{entry.node.tag}</small>
          {props.issues.get(entry.address)?.some((issue) => issue.severity === 'error') ? (
            <span className="issue" data-node-issue>
              {' '}
              ●
            </span>
          ) : null}
        </div>
      ))}
      {selected === undefined ? null : (
        <div>
          <select data-add-tag value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="" />
            {parts.map((descriptor) => (
              <option key={descriptor.id} value={descriptor.id}>
                {descriptor.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-add-child
            disabled={tag === ''}
            onClick={() =>
              store.edit([
                ...((selected.node as { children?: unknown }).children === undefined
                  ? [{ op: 'add' as const, path: `${selected.pointer}/children`, value: [] }]
                  : []),
                {
                  op: 'add',
                  path: `${selected.pointer}/children/-`,
                  value: { tag, id: `${tag.split('@')[0]}-${Date.now().toString(36)}` }
                }
              ])
            }
          >
            Add child
          </button>
          <button
            type="button"
            data-delete
            disabled={selected.parent === undefined}
            onClick={() => store.edit([{ op: 'remove', path: selected.pointer }])}
          >
            Delete
          </button>
          <button
            type="button"
            data-move-up
            onClick={() => store.edit(moveUpOps(selected.pointer))}
          >
            Up
          </button>
        </div>
      )}
    </div>
  )
}

/** Conflicts waiting for a choice. */
function Conflicts(): ReactNode {
  if (store.conflicts.length === 0) return null
  return (
    <div data-conflicts>
      {store.conflicts.map((conflict) => (
        <div
          className="issue"
          data-conflict={conflict.address}
          key={`${conflict.blueprint}|${conflict.path}`}
        >
          {conflict.blueprint} {conflict.address} {conflict.facet}
          <button type="button" data-keep="ours" onClick={() => store.resolve(conflict, 'ours')}>
            Keep mine
          </button>
          <button
            type="button"
            data-keep="theirs"
            onClick={() => store.resolve(conflict, 'theirs')}
          >
            Take theirs
          </button>
        </div>
      ))}
    </div>
  )
}

/** Editor page. */
function App(): ReactNode {
  useStore()
  if (store.phase !== Phase.ready) return <LoginForm />
  /** Selected document. */
  const document = store.document()
  /** Index entries. */
  const entries = [...(document?.index()?.entries() ?? [])]
  /** Issues of the selected document. */
  const issues = store.issues()
  /** Issues by address. */
  const byAddress = issuesByAddress(issues)
  /** Selected entry. */
  const selected = entries.find((entry) => entry.address === store.address)
  return (
    <>
      <Header />
      <Conflicts />
      <div className="columns">
        <section>
          {[...store.documents.keys()].map((id) => (
            <div
              className="node"
              data-blueprint={id}
              aria-selected={id === store.selected}
              key={id}
              onClick={() => store.selectBlueprint(id)}
            >
              {id}
            </div>
          ))}
          <hr />
          <Tree entries={entries} issues={byAddress} />
          <hr />
          <ModuleList store={store} />
        </section>
        <section>
          {store.module !== undefined ? (
            <ModuleEditor store={store} name={store.module} />
          ) : selected === undefined ? null : (
            <PropertyPanel
              store={store}
              entry={selected}
              issues={byAddress.get(selected.address) ?? []}
            />
          )}
        </section>
        <section>
          <iframe
            data-preview
            title="preview"
            src={CONFIG.preview}
            ref={(frame) => bridge.attach(frame?.contentWindow ?? null)}
          />
        </section>
      </div>
    </>
  )
}

/** Restores a tab's session, then renders the page. */
async function start(): Promise<void> {
  /** Remembered session. */
  const remembered = store.remembered()
  createRoot(document.getElementById('root') as HTMLElement).render(<App />)
  if (remembered !== undefined) await store.login(remembered.token, remembered.project)
}

void start()
