import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { preprocessImage } from "@/lib/image/preprocess";
import { PARSE_RECEIPT_SYSTEM_PROMPT } from "@/lib/prompts/parseReceipt";
import { ReceiptSchema } from "@/lib/schemas/receipt";
import type { LineItem, Receipt } from "@/lib/types/receipt";

const round = (n: number) => Math.round(n * 1e9) / 1e9;

function mergeItems(items: LineItem[]): LineItem[] {
  const map = new Map<string, LineItem>();
  for (const item of items) {
    const key = item.description.toLowerCase().trim();
    const existing = map.get(key);
    if (existing) {
      existing.quantity = round(existing.quantity + item.quantity);
      existing.line_total = round(existing.line_total + item.line_total);
      existing.unit_price = round(existing.line_total / existing.quantity);
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values()).map((item, i) => ({ ...item, id: i + 1 }));
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VISION_MODEL = process.env.VISION_MODEL ?? "gpt-4o-2024-08-06";
const TOTALS_TOLERANCE = 0.02;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const imageFile = formData.get("image");
  if (!imageFile || !(imageFile instanceof Blob)) {
    return NextResponse.json({ error: "Missing image field" }, { status: 400 });
  }

  const rawBuffer = Buffer.from(await imageFile.arrayBuffer());

  let processedBuffer: Buffer;
  try {
    processedBuffer = await preprocessImage(rawBuffer);
  } catch {
    return NextResponse.json({ error: "Image preprocessing failed" }, { status: 400 });
  }

  const base64Image = processedBuffer.toString("base64");

  let rawJson: string;
  try {
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PARSE_RECEIPT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64Image}`, detail: "high" },
            },
            { type: "text", text: "Extract all receipt data as JSON." },
          ],
        },
      ],
      max_tokens: 2048,
    });

    rawJson = completion.choices[0]?.message?.content ?? "";
    if (!rawJson) throw new Error("Empty model response");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown model error";
    return NextResponse.json({ error: `Model failure: ${message}` }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return NextResponse.json(
      { error: "Model returned non-JSON output", raw: rawJson },
      { status: 422 }
    );
  }

  const validation = ReceiptSchema.safeParse(parsed);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Schema validation failed", issues: validation.error.issues },
      { status: 422 }
    );
  }

  const receipt: Receipt = validation.data;

  receipt.items = mergeItems(receipt.items);

  const itemsSum = receipt.items.reduce((acc, item) => acc + item.line_total, 0);
  const computedTotal = itemsSum + receipt.tax + receipt.tip;
  const mismatch =
    receipt.total > 0 &&
    Math.abs(computedTotal - receipt.total) / receipt.total > TOTALS_TOLERANCE;

  if (mismatch) {
    receipt.warning = "totals_mismatch";
  }

  return NextResponse.json(receipt, { status: 200 });
}
