// @partom-generated sha256:ace6e9cb1f22b9a7e5c8da1bf3035c8aeb8285fc9237a0f8e490731bd22df326
import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { createElement, type ReactNode } from 'react'

/** Native <main> rendered with the blueprint props. */
export function HtmlMain(props: Record<string, unknown>): ReactNode {
  return createElement('main', props)
}
/** Part of the native <main> element. */
export const HtmlMainPart = definePart({
  id: 'html-main@1',
  behavior: { semantics: { element: 'main' } }
})

/** Native <h1> rendered with the blueprint props. */
export function HtmlH1(props: Record<string, unknown>): ReactNode {
  return createElement('h1', props)
}
/** Part of the native <h1> element. */
export const HtmlH1Part = definePart({
  id: 'html-h1@1',
  behavior: { semantics: { element: 'h1' } }
})

/** Native <p> rendered with the blueprint props. */
export function HtmlP(props: Record<string, unknown>): ReactNode {
  return createElement('p', props)
}
/** Part of the native <p> element. */
export const HtmlPPart = definePart({ id: 'html-p@1', behavior: { semantics: { element: 'p' } } })

/** Native <form> rendered with the blueprint props. */
export function HtmlForm(props: Record<string, unknown>): ReactNode {
  return createElement('form', props)
}
/** Part of the native <form> element. */
export const HtmlFormPart = definePart({
  id: 'html-form@1',
  behavior: { semantics: { element: 'form' } }
})

/** Plugin registering the native-element parts. */
export default definePartPlugin({
  name: 'orders-page-html',
  parts: [HtmlMainPart, HtmlH1Part, HtmlPPart, HtmlFormPart],
  implementations: [
    bindReactComponent(HtmlMainPart, HtmlMain),
    bindReactComponent(HtmlH1Part, HtmlH1),
    bindReactComponent(HtmlPPart, HtmlP),
    bindReactComponent(HtmlFormPart, HtmlForm)
  ]
})
