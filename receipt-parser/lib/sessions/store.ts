import { randomUUID } from "crypto";
import type { Receipt } from "@/lib/types/receipt";

export interface ItemClaim {
  itemId: number;
  sharedWith: number; // total claimants on this item, including self
}

export type InviteeStatus = "pending" | "paid" | "skipped";

export interface Invitee {
  id: string;
  name: string;
  alias: string; // email or phone — used for the demo "send"
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

interface CreateSessionInput {
  receipt: Receipt;
  hostName: string;
  hostAlias: string;
  invitees: { name: string; alias: string }[];
}

declare global {
  // eslint-disable-next-line no-var
  var __snapsplitSessions: Map<string, Session> | undefined;
}

const store: Map<string, Session> =
  globalThis.__snapsplitSessions ?? (globalThis.__snapsplitSessions = new Map());

export function createSession(input: CreateSessionInput): Session {
  const session: Session = {
    id: randomUUID(),
    receipt: input.receipt,
    hostName: input.hostName,
    hostAlias: input.hostAlias,
    invitees: input.invitees.map((i) => ({
      id: randomUUID(),
      name: i.name,
      alias: i.alias,
      status: "pending",
      claims: [],
    })),
    createdAt: Date.now(),
  };
  store.set(session.id, session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return store.get(sessionId);
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
