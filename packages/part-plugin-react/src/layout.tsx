import {
  LandmarkElement,
  LayoutProp,
  type ILayoutBehavior,
  type ILayoutRegion
} from '@migaia/part-contract'
import type { IResolvedNode } from '@migaia/part-host'
import {
  LayoutAttribute,
  layoutRegionId,
  type IDomFeatures,
  type ILayoutHandle
} from '@migaia/part-plugin-dom'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react'
import { PartReactText } from './text.ts'

/**
 * Whether the subtree renders inside a layout region. A layout under another layout is an inner
 * layout: its main region renders as a plain `div`, so the page keeps one `main` landmark, and it
 * renders no skip link.
 */
const InLayoutContext = createContext(false)

/** Props of a layout rendered without a component binding. */
export type ILayoutViewProps = {
  readonly node: IResolvedNode
  readonly layout: ILayoutBehavior
  readonly blueprintId: string
  readonly dom: IDomFeatures
  /** Resolved props of the node (labels, sizes, skip label). */
  readonly bound: Readonly<Record<string, unknown>>
  /** Rendered slot members per region name. */
  readonly content: Readonly<Record<string, readonly ReactNode[]>>
  /** Hands the root element to the node commit (aria, styles, events). */
  readonly setElement: (element: HTMLElement | null) => void
}

/** A string record prop, or an empty record. */
function stringRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Label of a region: the blueprint override first, then the declared label. */
function labelOf(
  region: ILayoutRegion,
  labels: Readonly<Record<string, unknown>>
): string | undefined {
  /** Override from the blueprint. */
  const override = labels[region.name]
  return typeof override === 'string' ? override : region.label
}

/**
 * Moves focus to the main region named by the skip link's `href` instead of navigating to the
 * fragment, so the URL stays unchanged.
 */
function focusSkipTarget(event: MouseEvent<HTMLAnchorElement>): void {
  /** Target id without the leading `#`. */
  const id = event.currentTarget.getAttribute('href')?.slice(1) ?? ''
  /** Main region element. */
  const target = event.currentTarget.ownerDocument.getElementById(id)
  if (target === null) return
  event.preventDefault()
  target.focus()
}

/** One region element wrapping its slot members. */
function regionElement(
  node: IResolvedNode,
  region: ILayoutRegion,
  outer: boolean,
  label: string | undefined,
  content: readonly ReactNode[] | undefined
): ReactNode {
  /** Element tag; an inner layout's main region is a plain container. */
  const Tag = region.landmark === 'main' && !outer ? 'div' : LandmarkElement[region.landmark]
  return (
    <Tag
      key={`region:${region.name}`}
      id={layoutRegionId(node.address, region.name)}
      {...{ [LayoutAttribute.region]: region.name }}
      aria-label={label}
    >
      <InLayoutContext.Provider value={true}>{content}</InLayoutContext.Provider>
    </Tag>
  )
}

/** Separator element of a resizable region. */
function separatorElement(region: ILayoutRegion): ReactNode {
  return <div key={`separator:${region.name}`} {...{ [LayoutAttribute.separator]: region.name }} />
}

/**
 * Children of the layout root in DOM order: skip link, collapse toggles, then regions with each
 * resizable region's separator on its main side.
 */
function layoutChildren(props: ILayoutViewProps, outer: boolean): ReactNode[] {
  const { node, layout, bound, content } = props
  /** Region label overrides. */
  const labels = stringRecord(bound[LayoutProp.labels])
  /** Position of main. */
  const main = layout.regions.findIndex((region) => region.landmark === 'main')
  /** Rendered children. */
  const children: ReactNode[] = []
  if (outer && layout.skipLink !== false) {
    /** Skip link text. */
    const text = bound[LayoutProp.skipLabel]
    children.push(
      <a
        key="skip"
        {...{ [LayoutAttribute.skip]: '' }}
        href={`#${layoutRegionId(node.address, (layout.regions[main] as ILayoutRegion).name)}`}
        onClick={focusSkipTarget}
      >
        {typeof text === 'string' ? text : PartReactText.skipToMain}
      </a>
    )
  }
  for (const region of layout.regions)
    if (region.collapseBelow !== undefined)
      children.push(
        <button
          key={`toggle:${region.name}`}
          type="button"
          {...{ [LayoutAttribute.toggle]: region.name }}
        >
          {labelOf(region, labels)}
        </button>
      )
  for (let index = 0; index < layout.regions.length; index += 1) {
    /** Region at this position. */
    const region = layout.regions[index] as ILayoutRegion
    if (region.resizable === true && index > main) children.push(separatorElement(region))
    children.push(regionElement(node, region, outer, labelOf(region, labels), content[region.name]))
    if (region.resizable === true && index < main) children.push(separatorElement(region))
  }
  return children
}

/** Reads the attach handle back from the rendered root's direct children. */
function handleOf(root: HTMLElement, node: IResolvedNode, blueprintId: string): ILayoutHandle {
  /** Region elements by name. */
  const regions: Record<string, HTMLElement> = {}
  /** Separator elements by region name. */
  const separators: Record<string, HTMLElement> = {}
  /** Toggle elements by region name. */
  const toggles: Record<string, HTMLElement> = {}
  /** Skip link, when rendered. */
  let skip: HTMLElement | undefined
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue
    /** Region name, when the child is a region. */
    const region = child.getAttribute(LayoutAttribute.region)
    /** Resized region name, when the child is a separator. */
    const separator = child.getAttribute(LayoutAttribute.separator)
    /** Opened region name, when the child is a toggle. */
    const toggle = child.getAttribute(LayoutAttribute.toggle)
    if (region !== null) regions[region] = child
    else if (separator !== null) separators[separator] = child
    else if (toggle !== null) toggles[toggle] = child
    else if (child.hasAttribute(LayoutAttribute.skip)) skip = child
  }
  return { blueprintId, node, element: root, regions, separators, toggles, skip }
}

/**
 * Renders a layout part that has no React binding: a root `div`, landmark region elements,
 * separators, collapse toggles and, for the outermost layout, a skip link. Behaviour comes from the
 * DOM plugin's `layout.attach`, called at commit and undone before the elements go away.
 */
export function LayoutView(props: ILayoutViewProps): ReactNode {
  /** Whether no enclosing layout exists. */
  const outer = !useContext(InLayoutContext)
  /** Rendered root element. */
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const { setElement, node, blueprintId, dom } = props
  /** Root ref: keeps the element for attach and hands it to the node commit. */
  const rootRef = useCallback(
    (element: HTMLDivElement | null) => {
      setRoot(element)
      setElement(element)
    },
    [setElement]
  )
  useLayoutEffect(
    () => (root === null ? undefined : dom.layout.attach(handleOf(root, node, blueprintId))),
    [root, node, blueprintId, dom]
  )
  return <div ref={rootRef}>{layoutChildren(props, outer)}</div>
}
