import { useEffect, type ReactNode } from 'react'
import { useOutletContext } from 'react-router'

/** Lets the active page supply its category links to the existing mobile menu. */
export type IPageNavigationContext = {
  readonly setPageNavigation: (navigation: ReactNode) => void
}

/** Registers stable page-owned navigation and releases it when that page leaves the outlet. */
export function usePageNavigation(navigation: ReactNode) {
  /** The root owns menu visibility; each page owns the links rendered inside it. */
  const { setPageNavigation } = useOutletContext<IPageNavigationContext>()
  useEffect(() => {
    setPageNavigation(navigation)
    return () => setPageNavigation(null)
  }, [navigation, setPageNavigation])
}
