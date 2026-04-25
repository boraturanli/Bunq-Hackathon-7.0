export interface LineItem {
  id: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Receipt {
  merchant: string | null;
  date: string | null;
  currency: string;
  items: LineItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  warning?: "totals_mismatch";
}
