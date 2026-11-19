// @partom-generated sha256:a9d83ec93ef592fb9cb156078afdbae1f683bef1186c9160b5e380f570587dc2
import { Chart } from '../../../components/chart.tsx'
import { definePart, definePartPlugin } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'

const summaries = [{ label: 'Open orders', count: 3 }]

/** Page code kept as is; its state variables arrive as props. */
export function Blackbox1() {
  return (
    <section>
      {summaries.map((summary) => {
        const format = (count: number) => `${summary.label}: ${count}`
        return <Chart key={summary.label} title={format(summary.count)} />
      })}
    </section>
  )
}

/** Black-box part of the page code above. */
export const Blackbox1Part = definePart({ id: 'orders-page-blackbox-1@1' })

/** Plugin registering the black-box part. */
export default definePartPlugin({
  name: 'orders-page-blackbox-1',
  parts: [Blackbox1Part],
  implementations: [bindReactComponent(Blackbox1Part, Blackbox1)]
})
