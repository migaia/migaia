/** Native construction intentionally supplies no library bootstrap or authority. */
const worker = new Worker(new URL('./unlaunched-worker.mjs', import.meta.url).href, {
  type: 'module'
})
/** Independent local business is observed before the missing-bootstrap result. */
let ordinary
/** This finite fixture deadline observes a hang; it is not the production bootstrap timer. */
let deadline
/** Actual worker messages carry only safe preparation evidence. */
const result = await new Promise((resolve, reject) => {
  deadline = setTimeout(() => resolve({ ordinary, code: 'PENDING' }), 11500)
  worker.onmessage = (event) => {
    if ('ordinary' in event.data) ordinary = event.data.ordinary
    if ('code' in event.data) resolve({ ordinary, code: event.data.code })
  }
  worker.onerror = (event) => reject(event.error)
})
clearTimeout(deadline)
worker.terminate()
console.log(JSON.stringify(result))
