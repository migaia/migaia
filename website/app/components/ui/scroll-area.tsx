import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import type { ComponentProps } from 'react'

type IScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root>

/** Provides the project-owned shadcn/Radix scroll surface and visible vertical thumb. */
export function ScrollArea({ children, className, ...props }: IScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={className} type="always" {...props}>
      <ScrollAreaPrimitive.Viewport className="scroll-area-viewport">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

type IScrollBarProps = ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>

/** Renders the shadcn-style scrollbar without replacing native wheel or keyboard behavior. */
export function ScrollBar({ className, orientation = 'vertical', ...props }: IScrollBarProps) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      className={`scroll-area-scrollbar ${orientation === 'horizontal' ? 'horizontal' : 'vertical'}${className ? ` ${className}` : ''}`}
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="scroll-area-thumb" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}
