export type Receipt = {
  id: string
  title: string
  subtotal: number
  tax: number
  total: number
  created_at: string
}

export type ReceiptItem = {
  id: string
  receipt_id: string
  item_name: string
  quantity: number
  price: number
}

export type Participant = {
  id: string
  receipt_id: string
  name: string
  joined_at: string
}

export type Selection = {
  id: string
  participant_id: string
  receipt_item_id: string
  qty: number
}
