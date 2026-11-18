import { defineLayout } from './define-layout.ts'
import { LayoutText } from './text.ts'

/** One column with a single main region. */
export const singleLayout = defineLayout({
  id: 'single@1',
  title: 'Single',
  direction: 'column',
  regions: [{ name: 'content', landmark: 'main' }]
})

/** Resizable main navigation beside the content; the navigation collapses below 720 px. */
export const navContentLayout = defineLayout({
  id: 'nav-content@1',
  title: 'Navigation and content',
  direction: 'row',
  regions: [
    {
      name: 'nav',
      landmark: 'navigation',
      label: LayoutText.mainNavigation,
      resizable: true,
      size: { default: 240, min: 160, max: 480 },
      collapseBelow: 720
    },
    { name: 'content', landmark: 'main' }
  ]
})

/**
 * Narrow fixed navigation rail, a resizable contents tree and the content. The rail collapses below
 * 960 px and the tree below 720 px.
 */
export const navTreeContentLayout = defineLayout({
  id: 'nav-tree-content@1',
  title: 'Navigation, tree and content',
  direction: 'row',
  regions: [
    {
      name: 'nav',
      landmark: 'navigation',
      label: LayoutText.mainNavigation,
      size: { default: 64 },
      collapseBelow: 960
    },
    {
      name: 'tree',
      landmark: 'navigation',
      label: LayoutText.contents,
      resizable: true,
      size: { default: 280, min: 200, max: 520 },
      collapseBelow: 720
    },
    { name: 'content', landmark: 'main' }
  ]
})

/** Header and footer around the content; header and footer size to content and do not scroll. */
export const headerContentFooterLayout = defineLayout({
  id: 'header-content-footer@1',
  title: 'Header, content and footer',
  direction: 'column',
  regions: [
    { name: 'header', landmark: 'banner', size: { default: 'auto' }, scroll: false },
    { name: 'content', landmark: 'main' },
    { name: 'footer', landmark: 'contentinfo', size: { default: 'auto' }, scroll: false }
  ]
})
