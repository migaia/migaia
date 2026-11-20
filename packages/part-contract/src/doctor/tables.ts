/**
 * Fixed reference tables used by built-in rules. Every table here has a size fixed at compile time,
 * so membership checks and iteration do not grow with the blueprint.
 */

/** Global HTML attributes allowed on every element (HTML living standard, global attributes). */
export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'class',
  'title',
  'lang',
  'dir',
  'hidden',
  'tabindex',
  'role',
  'draggable',
  'spellcheck',
  'translate',
  'accesskey',
  'autofocus',
  'inert',
  'popover',
  'slot',
  'part',
  'enterkeyhint',
  'inputmode'
])

/** Element-specific attributes for the elements parts most often render. */
export const ELEMENT_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['a', new Set(['href', 'target', 'rel', 'download', 'hreflang', 'type'])],
  [
    'button',
    new Set(['type', 'disabled', 'name', 'value', 'form', 'popovertarget', 'popovertargetaction'])
  ],
  [
    'input',
    new Set([
      'type',
      'name',
      'value',
      'placeholder',
      'disabled',
      'readonly',
      'required',
      'checked',
      'min',
      'max',
      'step',
      'pattern',
      'autocomplete',
      'maxlength',
      'minlength',
      'multiple',
      'list',
      'form',
      'size',
      'accept'
    ])
  ],
  ['img', new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes'])],
  ['label', new Set(['for'])],
  [
    'form',
    new Set(['action', 'method', 'novalidate', 'enctype', 'target', 'name', 'autocomplete'])
  ],
  [
    'textarea',
    new Set([
      'name',
      'placeholder',
      'rows',
      'cols',
      'disabled',
      'readonly',
      'required',
      'maxlength',
      'minlength',
      'wrap'
    ])
  ],
  ['select', new Set(['name', 'disabled', 'required', 'multiple', 'size', 'form'])],
  ['option', new Set(['value', 'disabled', 'selected', 'label'])],
  ['dialog', new Set(['open'])],
  ['ol', new Set(['start', 'reversed', 'type'])],
  ['td', new Set(['colspan', 'rowspan', 'headers'])],
  ['th', new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr'])]
])

/** Aria attributes (without the `aria-` prefix) whose values are id references. */
export const IDREF_ARIA: ReadonlySet<string> = new Set([
  'controls',
  'labelledby',
  'describedby',
  'owns',
  'activedescendant',
  'flowto',
  'details',
  'errormessage'
])

/** APG patterns whose widget must have an accessible name. */
export const NAMED_PATTERNS: ReadonlySet<string> = new Set([
  'combobox',
  'listbox',
  'dialog',
  'alertdialog',
  'slider',
  'tabs',
  'menu',
  'menubar',
  'tree',
  'radio-group',
  'toolbar'
])

/** Roles that make an element interactive, used by the non-interactive slot rule. */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'checkbox',
  'combobox',
  'menuitem',
  'option',
  'radio',
  'slider',
  'switch',
  'tab',
  'textbox',
  'treeitem'
])

/** Elements that are interactive by default. */
export const INTERACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary'
])

/** DOM event names a subscription may use without a declaration. */
export const DOM_EVENTS: ReadonlySet<string> = new Set([
  'click',
  'dblclick',
  'input',
  'change',
  'submit',
  'reset',
  'focus',
  'blur',
  'focusin',
  'focusout',
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'dragstart',
  'drag',
  'dragend',
  'dragenter',
  'dragover',
  'dragleave',
  'drop',
  'scrollend',
  'select',
  'paste',
  'copy',
  'cut',
  'contextmenu',
  'wheel',
  'scroll',
  'toggle',
  'close',
  'cancel'
])

/** Style keys that set stacking order; owned by the behavior rule, never valid as hooks. */
export const Z_INDEX_KEYS: ReadonlySet<string> = new Set(['z-index', 'zIndex'])

/** Custom event name grammar: plugin name, colon, event name. */
export const NAMESPACED_EVENT = /^[a-z0-9][a-z0-9-]*:[A-Za-z0-9-]+$/

/**
 * Bound state path grammar: a namespace (`page`, `section`, `part` or a registered store name,
 * lowercase first letter then letters and digits), then at least one `.`-separated key segment.
 * Whether the namespace is registered is checked separately against the host catalog.
 */
export const STATE_PATH = /^[a-z][a-zA-Z0-9]*(\.[A-Za-z0-9_-]+)+$/
