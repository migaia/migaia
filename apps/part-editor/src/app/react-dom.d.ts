/**
 * The part of `react-dom/client` the page uses. The workspace has no `@types/react-dom` and the
 * editor adds no dependency, so this declaration states only `createRoot`.
 */
declare module 'react-dom/client' {
  /** Root of a React tree mounted into one element. */
  export type IRoot = { render(node: unknown): void; unmount(): void }
  /** Creates a root for `container`. */
  export function createRoot(container: Element): IRoot
}
