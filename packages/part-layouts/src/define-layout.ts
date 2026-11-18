import type {
  ILayoutBehavior,
  ILayoutProps,
  ILayoutRegion,
  ISlotDeclaration
} from '@migaia/part-contract'
import { definePart, type IPartDefinition, type IPartSpec } from '@migaia/part-host'

/**
 * Layout specification: identity fields of a part plus the layout behaviour group. Focus, layer and
 * `managedBy` are not accepted; the layout behaviour decides them.
 */
export type ILayoutSpec = Pick<IPartSpec, 'id' | 'title' | 'description' | 'meta'> & ILayoutBehavior

/** Slot declaration of every region: no content type or count limit. */
const OPEN_SLOT: ISlotDeclaration = Object.freeze({})

/**
 * Defines a layout part. The descriptor carries `behavior.layout` and one open slot per region; the
 * root element is a generic container, so `semantics.element` is not set. Invalid layouts throw
 * `DESCRIPTOR_INVALID` synchronously from `validateDescriptor`.
 */
export function defineLayout(spec: ILayoutSpec): IPartDefinition<ILayoutProps> {
  /** One open slot per region, keyed by region name. */
  const slots: Record<string, ISlotDeclaration> = {}
  for (const region of spec.regions) slots[region.name] = OPEN_SLOT
  /** Frozen copies of the regions, so later edits to the spec cannot bypass validation. */
  const regions = Object.freeze(spec.regions.map(freezeRegion))
  /** Layout behaviour group copied from the spec. */
  const layout: ILayoutBehavior =
    spec.skipLink === undefined
      ? { direction: spec.direction, regions }
      : { direction: spec.direction, regions, skipLink: spec.skipLink }
  /** Identity fields the caller set; unset ones stay absent from the descriptor. */
  const { id, title, description, meta } = spec
  return definePart<ILayoutProps>({
    id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(meta === undefined ? {} : { meta }),
    behavior: { layout },
    slots
  })
}

/** Copies and freezes one region and its size. */
function freezeRegion(region: ILayoutRegion): ILayoutRegion {
  return Object.freeze(
    region.size === undefined
      ? { ...region }
      : { ...region, size: Object.freeze({ ...region.size }) }
  )
}
