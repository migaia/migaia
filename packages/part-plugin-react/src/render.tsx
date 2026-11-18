import type {
  IPartHost,
  IResolvedChanges,
  IResolvedNode,
  IResolvedTree,
  IRendererMount,
  IPartRendererFactory
} from '@migaia/part-host'
import type { IDomFeatures } from '@migaia/part-plugin-dom'
import type { IRuntime } from '@migaia/reactive'
import { useTracked } from '@migaia/store-react'
import {
  Component,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { REACT_RENDERER, type IReactBinding } from './bind.ts'
import { NodeCommit } from './commit.ts'
import { PartReactErrorCode } from './error-code.ts'
import { createPartReactError, PartReactErrorText } from './errors.ts'
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
    resolve(node: IResolvedNode, value: unknown): unknown
  }
  readonly dispatch: (address: string, event: string, detail: unknown) => Promise<void>
  readonly report: (error: unknown) => void
}

/** Context carrying the mount services to node components. */
const MountContext = createContext<IMountServices | undefined>(undefined)

/** Error code the host uses for failures it has already reported. */
const ALREADY_REPORTED = 'EFFECT_FAILED'

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

/** Resolves bound props and the open value of a node; reads are tracked by the caller. */
function readBound(
  services: IMountServices,
  node: IResolvedNode
): Readonly<Record<string, unknown>> {
  /** Resolved prop values. */
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.config.props ?? {}))
    resolved[key] = services.state.resolve(node, value)
  if (node.openStatePath !== undefined)
    resolved['\u0000open'] = services.state.read(node.openStatePath)
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

  /** Writes open state for the declared open-change event, then dispatches to the host. */
  #emit(detail: unknown): void {
    if (
      this.#node.behavior.states?.openChange === this.#name &&
      this.#node.openStatePath !== undefined
    )
      this.#services.state.write(this.#node.openStatePath, detail)
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
    if (key !== '\u0000open') props[String(mapping.props?.[key] ?? key)] = value
  for (const [name, target] of Object.entries(mapping.events ?? {}))
    props[String(target)] = new EventBridge(services, node, name).handle
  /** Child nodes rendered as React children unless a slot maps to `children`. */
  const children: ReactNode[] = node.children.map((child) => (
    <PartNode key={child.address} address={child.address} />
  ))
  for (const [slot, members] of Object.entries(node.slots)) {
    /** Rendered slot members. */
    const rendered = members.map((member) => (
      <PartNode key={member.address} address={member.address} />
    ))
    /** Target prop of the slot. */
    const target = mapping.slots?.[slot] ?? 'children'
    if (target === 'children') children.push(...rendered)
    else props[String(target)] = rendered
  }
  if (children.length > 0) props.children = children
  if (mapping.element !== 'query') props.ref = setElement
  return props
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
  /** Root element of the component after commit. */
  const [element, setElement] = useState<HTMLElement | null>(null)
  /** Commit helper living as long as this component. */
  const commit = useMemo(
    () =>
      new NodeCommit({
        dom: services.dom,
        write: (path, value) => services.state.write(path, value)
      }),
    [services]
  )
  /** Resolved bound values; reads are tracked on the host runtime. */
  const bound = useTracked(
    () => (node === undefined ? {} : readBound(services, node)),
    shallowEqual,
    services.runtime
  )
  useLayoutEffect(() => commit.release, [commit])
  useLayoutEffect(() => {
    if (node !== undefined) commit.apply(node, element, bound['\u0000open'] === true)
  }, [commit, node, element, bound])
  if (node === undefined) return null
  /** React binding of the part. */
  const binding = services.catalog.implementation(REACT_RENDERER, node.definition.descriptor.id) as
    | IReactBinding
    | undefined
  if (binding === undefined)
    throw createPartReactError(
      PartReactErrorCode.bindingMissing,
      PartReactErrorText.bindingMissing(node.definition.descriptor.id, address)
    )
  /** Component of the binding. */
  const Bound = binding.component
  return <Bound {...componentProps(services, node, binding, bound, setElement)} />
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
