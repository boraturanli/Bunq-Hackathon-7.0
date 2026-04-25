import { randomUUID } from "crypto";
import type { Receipt } from "@/lib/types/receipt";
import { registerUser } from "@/lib/users";

export interface ItemClaim {
  itemId: number;
  sharedWith: number; // total claimants on this item, including self
}

export type InviteeStatus = "pending" | "paid" | "skipped";

export interface Invitee {
  id: string;
  userId: string; // links to MockUser
  name: string;
  alias: string; // email — used for best-effort bunq integration
  status: InviteeStatus;
  claims: ItemClaim[];
  amountPaid?: number;
  paidAt?: number;
}

export interface Session {
  id: string;
  receipt: Receipt;
  hostName: string;
  hostAlias: string;
  invitees: Invitee[];
  createdAt: number;
}

interface InviteeInput {
  name: string;
  email: string;
  color?: string;
  source?: 'top-friend' | 'custom';
}

interface CreateSessionInput {
  receipt: Receipt;
  hostName: string;
  hostAlias: string;
  invitees: InviteeInput[];
}

declare global {
  // eslint-disable-next-line no-var
  var __snapsplitSessions: Map<string, Session> | undefined;
}

const store: Map<string, Session> =
  globalThis.__snapsplitSessions ?? (globalThis.__snapsplitSessions = new Map());

export function createSession(input: CreateSessionInput): Session {
  const invitees: Invitee[] = [];
  for (const inv of input.invitees) {
    const user = registerUser({
      name: inv.name,
      email: inv.email,
      color: inv.color,
      source: inv.source,
    });
    invitees.push({
      id: randomUUID(),
      userId: user.id,
      name: user.name,
      alias: user.email,
      status: "pending",
      claims: [],
    });
  }
  const session: Session = {
    id: randomUUID(),
    receipt: input.receipt,
    hostName: input.hostName,
    hostAlias: input.hostAlias,
    invitees,
    createdAt: Date.now(),
  };
  store.set(session.id, session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return store.get(sessionId);
}

export function findSessionsForUser(userId: string): { session: Session; invitee: Invitee }[] {
  const out: { session: Session; invitee: Invitee }[] = [];
  store.forEach((session) => {
    const invitee = session.invitees.find((i: Invitee) => i.userId === userId);
    if (invitee) out.push({ session, invitee });
  });
  return out.sort((a, b) => b.session.createdAt - a.session.createdAt);
}

export function getInvitee(sessionId: string, inviteeId: string): Invitee | undefined {
  return store.get(sessionId)?.invitees.find((i) => i.id === inviteeId);
}

export function recordPayment(
  sessionId: string,
  inviteeId: string,
  claims: ItemClaim[],
  amountPaid: number
): Invitee | undefined {
  const invitee = getInvitee(sessionId, inviteeId);
  if (!invitee) return undefined;
  invitee.claims = claims;
  invitee.amountPaid = amountPaid;
  invitee.status = "paid";
  invitee.paidAt = Date.now();
  return invitee;
}

export function recordSkip(sessionId: string, inviteeId: string): Invitee | undefined {
  const invitee = getInvitee(sessionId, inviteeId);
  if (!invitee) return undefined;
  invitee.claims = [];
  invitee.amountPaid = 0;
  invitee.status = "skipped";
  invitee.paidAt = Date.now();
  return invitee;
}
