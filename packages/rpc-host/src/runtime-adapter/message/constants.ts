/** Raw message-event names are shared by resource capture and canonical transport construction. */
export const MessageResourceEvent = {
  message: 'message',
  messageerror: 'messageerror',
  error: 'error',
  close: 'close'
} as const
