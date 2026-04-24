import { z } from "zod";

export const LineItemSchema = z.object({
  id: z.number().int(),
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  line_total: z.number(),
});

export const ReceiptSchema = z.object({
  merchant: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string(),
  items: z.array(LineItemSchema),
  subtotal: z.number(),
  tax: z.number(),
  tip: z.number(),
  total: z.number(),
  warning: z.literal("totals_mismatch").optional(),
});

export type ReceiptSchemaType = z.infer<typeof ReceiptSchema>;
