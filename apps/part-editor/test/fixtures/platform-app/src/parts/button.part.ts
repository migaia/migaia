import { definePart } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import { Button } from '../../components/ui/button.tsx'

export const buttonPart = definePart({
  id: 'button@1',
  editor: {
    variants: {
      variant: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
      size: ['default', 'sm', 'lg', 'icon']
    },
    defaults: {
      variant: 'default',
      size: 'default'
    }
  }
})
export const buttonBinding = bindReactComponent(buttonPart, Button, {})
