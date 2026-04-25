import { NextRequest, NextResponse } from "next/server";
import { colorFor, slugify, registerUser } from "@/lib/users";

const BUNQ_API = process.env.BUNQ_API_URL ?? "http://localhost:8000";

interface BunqContact {
  name: string;
  iban: string | null;
  pointer_type: string;
  pointer_value: string;
  transaction_count: number;
  last_seen: string;
  saved: boolean;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") ?? "5";

  let raw: BunqContact[];
  try {
    const res = await fetch(`${BUNQ_API}/api/contacts/top?n=${n}`, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `bunq returned ${res.status}: ${text}` },
        { status: 502 }
      );
    }
    raw = await res.json();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bunq unreachable" },
      { status: 502 }
    );
  }

  const enriched = raw.map((c) => {
    // Use email if pointer is email; otherwise fall back to a synthetic email-like
    // identifier built from the IBAN so the slug is stable + URL-safe.
    const email =
      c.pointer_type === "EMAIL" ? c.pointer_value : `${slugify(c.pointer_value)}@bunq.demo`;
    const id = slugify(email);
    const color = colorFor(id);
    // Pre-register so /inbox/<id> works as soon as someone opens the tab.
    registerUser({ name: c.name, email, color, source: "top-friend" });
    return {
      id,
      name: c.name,
      email,
      color,
      iban: c.iban,
      pointer_type: c.pointer_type,
      pointer_value: c.pointer_value,
      transaction_count: c.transaction_count,
    };
  });

  return NextResponse.json(enriched);
}
