import { idForAddress } from '../aria.ts'

/**
 * Element id of a layout region: the layout's address id plus the region name. Region names stay
 * inside the address alphabet, so the id needs no escaping. The renderer calls this while rendering
 * to write ids and skip-link `href`s; the attachment reads the same ids back.
 */
export function layoutRegionId(address: string, region: string): string {
  return `${idForAddress(address)}-${region}`
}
