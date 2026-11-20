import { forwardRef, memo, type ReactNode, type Ref } from 'react'

/** Button rendered through memo(forwardRef(...)). */
function Button(
  props: { label?: string; onPress?: () => void },
  ref: Ref<HTMLButtonElement>
): ReactNode {
  return (
    <button ref={ref} onClick={props.onPress}>
      {props.label}
    </button>
  )
}

export default memo(forwardRef(Button))
