import type {
  IPartHost,
  IResolvedChanges,
  IResolvedNode,
  IResolvedTree,
  IRendererMount,
  IPartRendererFactory,
  IResourceHandle,
  IResourceWatch
} from '@migaia/part-host'
import { formatAddress, parseAddress, type IResourceSnapshot } from '@migaia/part-contract'
import type { IDomFeatures } from '@migaia/part-plugin-dom'
import type { IRuntime } from '@migaia/reactive'
import { useTracked } from '@migaia/store-react'
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { REACT_RENDERER, type IReactBinding } from './bind.ts'
import { NodeCommit } from './commit.ts'
import {
  fieldPathOf,
  fieldValue,
  PENDING_SNAPSHOT,
  resourceAttributes,
  resourceBindingOf,
  rowsOf,
  startWatch,
  statusSlotNames,
  statusSlotOf
} from './data-node.ts'
import { PartReactErrorCode } from './error-code.ts'
import { createPartReactError, PartReactErrorText } from './errors.ts'
import { LayoutView } from './layout.tsx'
import { NodeStore } from './node-store.ts'

/** Services shared by every node of one mount. */
export type IMountServices = {
  readonly store: NodeStore
  readonly runtime: IRuntime
  readonly dom: IDomFeatures
  readonly catalog: { implementation(renderer: string, partId: string): unknown }
  readonly state: {
    read(path: string): unknown
    write(path: string, value: unknown): void
    resolve(node: IResolvedNode, value: unknown, row?: Readonly<Record<string, unknown>>): unknown
  }
  readonly dispatch: (address: string, event: string, detail: unknown) => Promise<void>
  readonly report: (error: unknown) => void
  readonly resources: IResourceHandle
}

/** Context carrying the mount services to node components. */
const MountContext = createContext<IMountServices | undefined>(undefined)

/** Template row a subtree renders for: its key and row object. */
type IRowScope = { readonly key: string; readonly row: Readonly<Record<string, unknown>> }

/**
 * Context carrying the current template row. Every node under a row renders as the instance address
 * `<static address>@row:<key>` and resolves `$row` bindings against the row.
 */
const RowContext = createContext<IRowScope | undefined>(undefined)

/** Error code the host uses for failures it has already reported. */
const ALREADY_REPORTED = 'EFFECT_FAILED'

/**
 * Prefix of bound entries that are not component props. A NUL character cannot appear in an
 * authored prop name, so these keys never collide with props.
 */
const INTERNAL_KEY = '\u0000'
/** Bound entry holding the rows of a template host. */
const ROWS_KEY = `${INTERNAL_KEY}rows`
/** Bound entry holding the current open value. */
const OPEN_KEY = `${INTERNAL_KEY}open`
/** Prefix of bound entries holding state-derived aria values, followed by the attribute name. */
const ARIA_KEY = `${INTERNAL_KEY}aria:`
/** Bound entry holding the resource snapshot of a resource node. */
const SNAPSHOT_KEY = `${INTERNAL_KEY}snapshot`

/** State-derived aria values taken out of a bound record. */
function ariaValues(bound: Readonly<Record<string, unknown>>): Record<string, unknown> {
  /** Collected values by attribute name. */
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(bound))
    if (key.startsWith(ARIA_KEY)) values[key.slice(ARIA_KEY.length)] = value
  return values
}

/** Shallow equality of two prop records. */
function shallowEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>
): boolean {
  /** Keys of the first record. */
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (!Object.is(a[key], b[key])) return false
  return true
}

/**
 * Resolves bound props, template rows, the open value and state-derived aria of a node; reads are
 * tracked by the caller. `row` is the enclosing template row, used by `$row` bindings.
 */
function readBound(
  services: IMountServices,
  node: IResolvedNode,
  row: IRowScope | undefined,
  watch: IResourceWatch | undefined
): Readonly<Record<string, unknown>> {
  /** Resolved prop values. */
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.config.props ?? {}))
    resolved[key] = services.state.resolve(node, value, row?.row)
  /** Snapshot of a resource node; the pending one until the commit-phase watch exists. */
  const snapshot =
    resourceBindingOf(node) === undefined ? undefined : (watch?.read() ?? PENDING_SNAPSHOT)
  if (snapshot !== undefined) {
    resolved[node.behavior.resource?.prop as string] = snapshot
    resolved[SNAPSHOT_KEY] = snapshot
  }
  if (node.template !== undefined)
    resolved[ROWS_KEY] =
      snapshot !== undefined && node.template.rows === undefined
        ? rowsOf(snapshot)
        : services.state.resolve(node, node.template.rows, row?.row)
  if (node.openStatePath !== undefined) resolved[OPEN_KEY] = services.state.read(node.openStatePath)
  for (const [name, path] of Object.entries(node.ariaStates))
    resolved[`${ARIA_KEY}${name}`] = services.state.read(path)
  return resolved
}

/** Event bridge of one component-event prop: forwards a call to the host, writing open state first. */
class EventBridge {
  /** Mount services. */
  readonly #services: IMountServices
  /** Node of the event. */
  readonly #node: IResolvedNode
  /** Canonical event name. */
  readonly #name: string

  /** Captures the event target. */
  constructor(services: IMountServices, node: IResolvedNode, name: string) {
    this.#services = services
    this.#node = node
    this.#name = name
  }

  /** Handler passed to the component as its callback prop. */
  readonly handle = (detail: unknown): void => this.#emit(detail)

  /**
   * Writes open state for the declared open-change event and the field value for the field's change
   * event, then dispatches to the host.
   */
  #emit(detail: unknown): void {
    if (
      this.#node.behavior.states?.openChange === this.#name &&
      this.#node.openStatePath !== undefined
    )
      this.#services.state.write(this.#node.openStatePath, detail)
    /** Field protocol of the part. */
    const field = this.#node.behavior.field
    /** Bound state path of the field value. */
    const path = field?.change === this.#name ? fieldPathOf(this.#node) : undefined
    if (field !== undefined && path !== undefined)
      this.#services.state.write(path, fieldValue(field, detail))
    this.#services
      .dispatch(this.#node.address, this.#name, detail)
      .catch((error: unknown) => this.#rejected(error))
  }

  /** Reports a failure unless the host already reported it. */
  #rejected(error: unknown): void {
    if ((error as { code?: unknown } | undefined)?.code !== ALREADY_REPORTED)
      this.#services.report(error)
  }
}

/** Builds the component props of a node from its binding, resolved values and child elements. */
function componentProps(
  services: IMountServices,
  node: IResolvedNode,
  binding: IReactBinding,
  bound: Readonly<Record<string, unknown>>,
  setElement: (element: HTMLElement | null) => void
): Record<string, unknown> {
  /** Props handed to the component. */
  const props: Record<string, unknown> = {}
  /** Mapping of the binding. */
  const mapping = binding.mapping
  for (const [key, value] of Object.entries(bound))
    if (!key.startsWith(INTERNAL_KEY)) props[String(mapping.props?.[key] ?? key)] = value
  for (const [name, target] of Object.entries(mapping.events ?? {}))
    props[String(target)] = new EventBridge(services, node, name).handle
  /** Child nodes rendered as React children unless a slot maps to `children`. */
  const children: ReactNode[] = node.children.map((child) => (
    <PartNode key={child.address} address={child.address} />
  ))
  /** Status slots of a resource node, shown only instead of the component. */
  const statusSlots = statusSlotNames(node)
  for (const [slot, rendered] of Object.entries(slotContent(node))) {
    if (statusSlots.has(slot)) continue
    /** Target prop of the slot. */
    const target = mapping.slots?.[slot] ?? 'children'
    if (target === 'children') children.push(...rendered)
    else props[String(target)] = rendered
  }
  if (node.template !== undefined) children.push(...rowElements(node.template, bound[ROWS_KEY]))
  if (children.length > 0) props.children = children
  if (mapping.element !== 'query') props.ref = setElement
  return props
}

/**
 * One rendered template node per row. Rows that are not objects are skipped; the key is the string
 * value of the row's `rowKey` field.
 */
function rowElements(template: NonNullable<IResolvedNode['template']>, rows: unknown): ReactNode[] {
  /** Rendered rows. */
  const rendered: ReactNode[] = []
  if (!Array.isArray(rows)) return rendered
  for (const row of rows as unknown[]) {
    if (typeof row !== 'object' || row === null) continue
    /** Instance key of the row. */
    const key = String((row as Record<string, unknown>)[template.rowKey])
    rendered.push(
      <RowContext.Provider key={key} value={{ key, row: row as Readonly<Record<string, unknown>> }}>
        <PartNode address={template.node.address} />
      </RowContext.Provider>
    )
  }
  return rendered
}

/** Rendered members of every slot of a node, by slot name. */
function slotContent(node: IResolvedNode): Record<string, ReactNode[]> {
  /** Rendered members by slot. */
  const content: Record<string, ReactNode[]> = {}
  for (const [slot, members] of Object.entries(node.slots))
    content[slot] = members.map((member) => (
      <PartNode key={member.address} address={member.address} />
    ))
  return content
}

/** The node as rendered for a template row: same node, row-instance address. */
function instanceOf(node: IResolvedNode, row: IRowScope | undefined): IResolvedNode {
  return row === undefined
    ? node
    : {
        ...node,
        address: formatAddress({ segments: parseAddress(node.address).segments, rowKey: row.key })
      }
}

/** Renders one node from the store; subscribes only to its own address. */
function NodeView({ address }: { readonly address: string }): ReactNode {
  /** Mount services. */
  const services = useContext(MountContext) as IMountServices
  /** Current node of the address. */
  const node = useSyncExternalStore(
    (listener) => services.store.subscribe(address, listener),
    () => services.store.get(address)
  )
  /** Enclosing template row, if any. */
  const row = useContext(RowContext)
  /** Node as rendered here: the row-instance address inside a template row. */
  const instance = useMemo(
    () => (node === undefined ? undefined : instanceOf(node, row)),
    [node, row]
  )
  /** Whether this view renders a template-row instance. */
  const inRow = row !== undefined
  /** Root element of the component after commit. */
  const [element, setElement] = useState<HTMLElement | null>(null)
  /** Resource binding of the node, when it is a resource node. */
  const resourceBinding = resourceBindingOf(instance)
  /** Watch of the resource binding, created in the commit phase. */
  const [watch, setWatch] = useState<IResourceWatch | undefined>(undefined)
  useEffect(
    () => startWatch(services.resources, resourceBinding, row?.row, setWatch),
    [services, resourceBinding, row]
  )
  /** Commit helper living as long as this component. */
  const commit = useMemo(
    () =>
      new NodeCommit({
        dom: services.dom,
        write: (path, value) => services.state.write(path, value),
        rowInstance: inRow
      }),
    [services, inRow]
  )
  /** Resolved bound values; reads are tracked on the host runtime. */
  const bound = useTracked(
    () => (instance === undefined ? {} : readBound(services, instance, row, watch)),
    shallowEqual,
    services.runtime
  )
  useLayoutEffect(() => commit.release, [commit])
  /** Snapshot of a resource node. */
  const snapshot = bound[SNAPSHOT_KEY] as IResourceSnapshot | undefined
  useLayoutEffect(() => {
    if (instance !== undefined)
      commit.apply(
        instance,
        element,
        bound[OPEN_KEY] === true,
        ariaValues(bound),
        snapshot === undefined ? {} : resourceAttributes(snapshot)
      )
  }, [commit, instance, element, bound, snapshot])
  if (instance === undefined) return null
  /** Status slot shown instead of the component. */
  const statusSlot = snapshot === undefined ? undefined : statusSlotOf(instance, snapshot)
  if (statusSlot !== undefined)
    return (
      <div ref={setElement} style={{ display: 'contents' }} data-part-address={instance.address}>
        {slotContent(instance)[statusSlot]}
      </div>
    )
  /** React binding of the part. */
  const binding = services.catalog.implementation(
    REACT_RENDERER,
    instance.definition.descriptor.id
  ) as IReactBinding | undefined
  if (binding === undefined && instance.behavior.layout !== undefined)
    return (
      <LayoutView
        node={instance}
        layout={instance.behavior.layout}
        blueprintId={services.store.blueprintId}
        dom={services.dom}
        bound={bound}
        content={slotContent(instance)}
        setElement={setElement}
      />
    )
  if (binding === undefined)
    throw createPartReactError(
      PartReactErrorCode.bindingMissing,
      PartReactErrorText.bindingMissing(instance.definition.descriptor.id, instance.address)
    )
  /** Component of the binding. */
  const Bound = binding.component
  return <Bound {...componentProps(services, instance, binding, bound, setElement)} />
}

/** Error boundary isolating one node; reports the failure once and renders nothing. */
class NodeBoundary extends Component<
  {
    readonly address: string
    readonly report: (error: unknown) => void
    readonly children: ReactNode
  },
  { readonly failed: boolean }
> {
  /** Initial state: not failed. */
  override state = { failed: false }

  /** Switches to the failed state. */
  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  /** Reports the failure, keeping coded errors as they are and wrapping others as RENDER_FAILED. */
  override componentDidCatch(error: unknown): void {
    /** Whether the error already carries this package's identity. */
    const coded = (error as { source?: unknown } | undefined)?.source === 'part.react'
    this.props.report(
      coded
        ? error
        : createPartReactError(
            PartReactErrorCode.renderFailed,
            PartReactErrorText.renderFailed(this.props.address),
            error
          )
    )
  }

  /** Renders children until a failure. */
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/** Node wrapped in its error boundary. */
function PartNode({ address }: { readonly address: string }): ReactNode {
  /** Mount services. */
  const services = useContext(MountContext) as IMountServices
  return (
    <NodeBoundary address={address} report={services.report}>
      <NodeView address={address} />
    </NodeBoundary>
  )
}

/** One mount: a React root rendering one blueprint tree. */
class ReactMount implements IRendererMount {
  /** React root of the mount. */
  readonly #root: Root
  /** Node store of the mount. */
  readonly #store: NodeStore
  /** Whether unmount already ran. */
  #unmounted = false

  /** Creates the root and renders the tree. */
  constructor(target: Element, tree: IResolvedTree, services: Omit<IMountServices, 'store'>) {
    this.#store = new NodeStore(tree)
    this.#root = createRoot(target)
    this.#root.render(
      <MountContext.Provider value={{ ...services, store: this.#store }}>
        <PartNode address={this.#store.rootAddress} />
      </MountContext.Provider>
    )
  }

  /** Applies a change set to the store; only changed nodes re-render. */
  update(changes: IResolvedChanges): void {
    if (!this.#unmounted) this.#store.update(changes)
  }

  /** Unmounts the root once. */
  unmount(): void {
    if (this.#unmounted) return
    this.#unmounted = true
    this.#root.unmount()
  }
}

/** Renderer factory registered in the host render slot. */
export class ReactRendererFactory implements IPartRendererFactory {
  /** Services shared by every mount of this host. */
  readonly #services: Omit<IMountServices, 'store'>

  /** Captures host and DOM services. */
  constructor(services: Omit<IMountServices, 'store'>) {
    this.#services = services
  }

  /** Creates one mount with its own React root. */
  create(target: unknown, tree: IResolvedTree, _host: IPartHost): IRendererMount {
    return new ReactMount(target as Element, tree, this.#services)
  }
}
