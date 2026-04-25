import { NextRequest, NextResponse } from "next/server";
import { listUsers, registerUser } from "@/lib/users";

export async function GET() {
  return NextResponse.json(listUsers());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, color, source } = body ?? {};
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    const user = registerUser({ name, email, color, source });
    return NextResponse.json(user);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
