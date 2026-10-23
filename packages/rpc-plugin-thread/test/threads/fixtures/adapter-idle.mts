/** Native adapter tests retain a real live Worker until the original handle terminates it. */
setInterval(() => undefined, 1000)
