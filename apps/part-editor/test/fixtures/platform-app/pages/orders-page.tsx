import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'

import { Chart } from '../components/chart.tsx'
import { Button } from '../components/ui/button.tsx'
import { DataTable } from '../components/ui/data-table.tsx'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '../components/ui/form.tsx'
import { Input } from '../components/ui/input.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select.tsx'

type Order = { id: string; customer: string; status: string }

const columns = [
  { accessorKey: 'id', header: 'Order' },
  { accessorKey: 'customer', header: 'Customer' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }: { row: { getValue(key: string): string } }) => (
      <span className="capitalize">{row.getValue('status')}</span>
    )
  }
]

const summaries = [{ label: 'Open orders', count: 3 }]

export function OrdersPage() {
  const [status, setStatus] = useState('open')
  const [orders, setOrders] = useState<Order[]>([])
  const form = useForm<{ customer: string }>({ defaultValues: { customer: '' } })

  useEffect(() => {
    fetch(`/api/orders?status=${status}`)
      .then((response) => response.json())
      .then(setOrders)
  }, [status])

  function onSubmit(values: { customer: string }) {
    fetch('/api/orders', { method: 'POST', body: JSON.stringify(values) })
  }

  return (
    <main className="space-y-6 p-6">
      <h1>Orders</h1>
      <p>Track and create customer orders.</p>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger>
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>
      <DataTable columns={columns} data={orders} getRowId={(row: Order) => row.id} />
      <section>
        {summaries.map((summary) => {
          const format = (count: number) => `${summary.label}: ${count}`
          return <Chart key={summary.label} title={format(summary.count)} />
        })}
      </section>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="customer"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Customer</FormLabel>
                <FormControl>
                  <Input placeholder="Customer name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Create order</Button>
        </form>
      </Form>
    </main>
  )
}
