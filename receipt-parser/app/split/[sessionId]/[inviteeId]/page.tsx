'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Receipt, LineItem } from '@/lib/types/receipt';
import { TOK, FONT_DISPLAY, FONT_MONO } from '@/lib/design/tokens';
import { ICN } from '@/lib/design/icons';
import { Money, Avatar } from '@/lib/design/primitives';

const MAX_SHARE = 6;

interface SessionView {
  id: string;
  receipt: Receipt;
  hostName: string;
  invitees: { id: string; name: string; status: string; claims: { itemId: number }[] }[];
}

type Screen = 'loading' | 'receipt' | 'paying' | 'done' | 'skipped' | 'error' | 'expired';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}
function splitMoney(amount: number): [string, string] {
  const whole = Math.floor(amount).toLocaleString();
  const cents = String(Math.round((amount % 1) * 100)).padStart(2, '0');
  return [whole, cents];
}
function hashColor(s: string): string {
  const palette = [TOK.plum, TOK.amber, TOK.teal, TOK.rose, TOK.ocean, TOK.lime, TOK.violet, TOK.mint];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

function computeTotal(receipt: Receipt, claims: Record<number, number>): number {
  const subtotal = receipt.items.reduce((s, i) => s + i.line_total, 0);
  let food = 0;
  for (const item of receipt.items) {
    const share = claims[item.id] ?? 0;
    if (share > 0) food += item.line_total / share;
  }
  const extras = subtotal > 0 ? (food / subtotal) * (receipt.tax + receipt.tip) : 0;
  return Math.round((food + extras) * 100) / 100;
}

export default function InviteePage({ params }: { params: { sessionId: string; inviteeId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inboxUser = searchParams.get('inbox');

  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<SessionView | null>(null);
  const [me, setMe] = useState<{ id: string; name: string; status: string } | null>(null);
  const [claims, setClaims] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<{ itemId: number; itemName: string; paidBy: string }[]>([]);
  const [pendingSession, setPendingSession] = useState<SessionView | null>(null);

  const goBackToInbox = () => { if (inboxUser) router.push(`/inbox/${inboxUser}`); };

  useEffect(() => {
    fetch(`/api/session/${params.sessionId}`)
      .then(async (res) => {
        if (res.status === 404) { setScreen('expired'); return; }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data: SessionView = await res.json();
        setSession(data);
        const invitee = data.invitees.find((i) => i.id === params.inviteeId);
        if (!invitee) { setScreen('expired'); return; }
        setMe(invitee);
        if (invitee.status === 'paid') setScreen('done');
        else if (invitee.status === 'skipped') setScreen('skipped');
        else setScreen('receipt');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setScreen('error');
      });
  }, [params.sessionId, params.inviteeId]);

  const total = useMemo(() => session ? computeTotal(session.receipt, claims) : 0, [session, claims]);
  const hasClaims = Object.values(claims).some((v) => v > 0);

  const updateShare = (itemId: number, next: number) => {
    setClaims((prev) => {
      const updated = { ...prev };
      if (next <= 0) {
        delete updated[itemId];
      } else {
        updated[itemId] = next;
      }
      return updated;
    });
  };

  const submitPay = async () => {
    if (!session || !me) return;
    setScreen('paying');
    const claimsArray = Object.entries(claims).filter(([, v]) => v > 0).map(([k, v]) => ({ itemId: Number(k), sharedWith: v }));
    try {
      const res = await fetch(`/api/session/${params.sessionId}/${params.inviteeId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claims: claimsArray }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflicts) {
        const conflictIds = new Set(data.conflicts.map((c: { itemId: number }) => c.itemId));
        setClaims(prev => {
          const next = { ...prev };
          conflictIds.forEach(id => delete next[id as number]);
          return next;
        });
        // Fetch fresh session but hold it until user dismisses the modal
        const fresh = await fetch(`/api/session/${params.sessionId}`).then(r => r.json());
        setPendingSession(fresh);
        setConflicts(data.conflicts);
        setScreen('receipt');
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? 'Payment failed');
      setPaidAmount(data.amountPaid);
      setScreen('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
      setScreen('error');
    }
  };

  const submitSkip = async () => {
    if (!session || !me) return;
    try {
      const res = await fetch(`/api/session/${params.sessionId}/${params.inviteeId}/skip`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Skip failed');
      }
      setScreen('skipped');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Skip failed');
      setScreen('error');
    }
  };

  // ─── states ──────────────────────────────────────────────────────────────

  if (screen === 'loading') return <Centered text="Loading receipt…" />;

  if (screen === 'expired') return (
    <Centered>
      <div style={{ fontSize: 48, marginBottom: 12 }}>⌛</div>
      <h2 style={titleStyle}>Link expired</h2>
      <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 8 }}>This invite link is no longer valid.</p>
    </Centered>
  );

  if (screen === 'error') return (
    <Centered>
      <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
      <h2 style={titleStyle}>Something went wrong</h2>
      <p style={{ fontSize: 13, color: TOK.scarlet, marginTop: 8 }}>{error}</p>
      <button style={primaryBtn} onClick={() => setScreen('receipt')}>Try Again</button>
    </Centered>
  );

  if (screen === 'paying') return (
    <Centered>
      <div style={{ fontSize: 48, marginBottom: 12 }}>💸</div>
      <h2 style={titleStyle}>Paying via bunq…</h2>
      <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 8 }}>Just a moment</p>
    </Centered>
  );

  if (screen === 'done' && session && me) return (
    <Centered>
      <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
      <h2 style={titleStyle}>Paid!</h2>
      <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 8 }}>
        {paidAmount != null
          ? <>{formatAmount(paidAmount, session.receipt.currency)} sent to {session.hostName}</>
          : <>Paid to {session.hostName}</>}
      </p>
      {inboxUser ? (
        <button style={primaryBtn} onClick={goBackToInbox}>← Back to inbox</button>
      ) : (
        <p style={{ fontSize: 12, color: TOK.textFaint, marginTop: 16 }}>You can close this tab.</p>
      )}
    </Centered>
  );

  if (screen === 'skipped' && session) return (
    <Centered>
      <div style={{ fontSize: 56, marginBottom: 12 }}>👋</div>
      <h2 style={titleStyle}>No problem</h2>
      <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 8 }}>You haven&apos;t been charged. Thanks!</p>
      {inboxUser && (
        <button style={primaryBtn} onClick={goBackToInbox}>← Back to inbox</button>
      )}
    </Centered>
  );

  // ─── receipt (main) ──────────────────────────────────────────────────────

  if (screen === 'receipt' && session && me) {
    // Items already paid for by other invitees
    const paidItemIds = new Set(
      session.invitees
        .filter(i => i.id !== me.id && i.status === 'paid')
        .flatMap(i => i.claims.map((c: { itemId: number }) => c.itemId))
    );
    const visibleItems = session.receipt.items.filter(i => !paidItemIds.has(i.id));

    const accentColor = hashColor(session.hostName);
    return (
      <main style={{ minHeight: '100vh', background: TOK.bg, color: TOK.text, paddingBottom: 120 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>

          {/* Top bar */}
          <div style={{ paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            {inboxUser ? (
              <button onClick={goBackToInbox} style={iconBtn}>{ICN.chevL()}</button>
            ) : <div style={{ width: 36 }} />}
            <span style={{ fontSize: 11, fontWeight: 800, color: accentColor, letterSpacing: '0.08em', fontFamily: FONT_MONO, display: 'flex', alignItems: 'center', gap: 5 }}>
              {ICN.sparkle(accentColor)} {session.hostName.toUpperCase()}
            </span>
            <div style={{ width: 36 }} />
          </div>

          {/* Hero */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Avatar name={session.hostName} color={accentColor} size={36} />
            <p style={{ fontSize: 12, color: TOK.textDim }}>
              <strong style={{ color: TOK.text }}>{session.hostName}</strong> wants to split
            </p>
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            {session.receipt.merchant ?? 'a receipt'}
          </h1>
          <p style={{ fontSize: 13, color: TOK.textDim, marginTop: 8 }}>
            Tap an item to claim it. Use +/– to share it with others.
          </p>

          {/* Total summary */}
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 12,
            background: TOK.surface, border: `1px solid ${TOK.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: TOK.textDim, fontFamily: FONT_MONO }}>RECEIPT TOTAL</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700 }}>
              {formatAmount(session.receipt.total, session.receipt.currency)}
            </span>
          </div>

          {/* Conflict modal */}
          {conflicts.length > 0 && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 100, padding: 24,
            }}>
              <div style={{
                background: TOK.surface, borderRadius: 20, padding: 28,
                maxWidth: 340, width: '100%', textAlign: 'center',
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  Just missed it
                </h3>
                {conflicts.map((c, i) => (
                  <p key={i} style={{ fontSize: 14, color: TOK.textDim, marginBottom: 4 }}>
                    <strong style={{ color: TOK.text }}>{c.paidBy}</strong> already paid for <strong style={{ color: TOK.text }}>{c.itemName}</strong>
                  </p>
                ))}
                <p style={{ fontSize: 13, color: TOK.textFaint, marginTop: 12, marginBottom: 20 }}>
                  Those items have been removed from your receipt.
                </p>
                <button
                  onClick={() => {
                    if (pendingSession) { setSession(pendingSession); setPendingSession(null); }
                    setConflicts([]);
                  }}
                  style={{ ...primaryBtn, width: '100%' }}
                >
                  Got it
                </button>
              </div>
            </div>
          )}

          {/* Items */}
          <div style={{ marginTop: 16 }}>
            {visibleItems.map((item: LineItem) => {
              const share = claims[item.id] ?? 0;
              const claimed = share > 0;
              const myCost = claimed ? item.line_total / share : 0;
              return (
                <div
                  key={item.id}
                  onClick={() => updateShare(item.id, claimed ? 0 : 1)}
                  style={{
                    padding: '14px 16px', marginBottom: 10,
                    borderRadius: 18, cursor: 'pointer',
                    border: `1.5px solid ${claimed ? TOK.accent : TOK.border}`,
                    background: claimed ? `${TOK.accent}08` : TOK.surface,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {/* Top row: checkbox · name/qty · price */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                      border: `1.5px solid ${claimed ? TOK.accent : TOK.borderHi}`,
                      background: claimed ? TOK.accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {claimed && ICN.check(TOK.accentInk)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{item.description}</p>
                      <p style={{ fontSize: 12, color: TOK.textDim, marginTop: 2 }}>
                        {item.quantity > 1 ? `×${item.quantity} · ` : ''}{formatAmount(item.line_total, session.receipt.currency)}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {claimed ? (
                        <>
                          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, color: TOK.accent }}>
                            {formatAmount(myCost, session.receipt.currency)}
                          </p>
                          <p style={{ fontSize: 10, color: TOK.textDim, marginTop: 2 }}>
                            {share === 1 ? 'yours' : `÷${share}`}
                          </p>
                        </>
                      ) : (
                        <p style={{ fontSize: 12, color: TOK.textFaint }}>tap to claim</p>
                      )}
                    </div>
                  </div>

                  {/* Share controls — only when claimed, stops click propagation */}
                  {claimed && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        marginTop: 12, paddingTop: 12,
                        borderTop: `1px solid ${TOK.accent}30`,
                      }}
                    >
                      <span style={{ fontSize: 11, color: TOK.textDim, flex: 1 }}>
                        {share === 1 ? 'Only you' : `${share} people sharing`}
                      </span>
                      <button
                        onClick={() => updateShare(item.id, Math.max(0, share - 1))}
                        style={{
                          width: 32, height: 32, borderRadius: 10,
                          border: `1px solid ${TOK.border}`, background: TOK.surface2,
                          color: TOK.text, fontSize: 18, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >–</button>
                      <span style={{ minWidth: 20, textAlign: 'center', fontSize: 15, fontWeight: 700 }}>{share}</span>
                      <button
                        onClick={() => updateShare(item.id, Math.min(MAX_SHARE, share + 1))}
                        style={{
                          width: 32, height: 32, borderRadius: 10,
                          border: `1px solid ${TOK.border}`, background: TOK.surface2,
                          color: TOK.text, fontSize: 18, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {visibleItems.length === 0 && (
            <p style={{ fontSize: 14, color: TOK.textDim, textAlign: 'center', padding: '24px 0' }}>
              All items have been claimed. Tap &ldquo;I had nothing&rdquo; if you&apos;re done.
            </p>
          )}

          {session.receipt.tax > 0 && (
            <p style={{ fontSize: 11, color: TOK.textFaint, marginTop: 10, fontFamily: FONT_MONO }}>
              Tax & tip distributed proportionally to what you claim.
            </p>
          )}

          <button onClick={submitSkip} style={{
            display: 'block', width: '100%', marginTop: 16, padding: '12px',
            background: 'transparent', color: TOK.textDim,
            border: `1px solid ${TOK.border}`, borderRadius: 12,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            I had nothing
          </button>
        </div>

        {/* Sticky bottom pay bar */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.98) 70%, rgba(0,0,0,0))',
          padding: '20px 16px 28px',
          backdropFilter: 'blur(20px)',
          borderTop: `1px solid ${TOK.border}`,
          zIndex: 10,
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: TOK.textDim, fontFamily: FONT_MONO, fontWeight: 700, letterSpacing: '0.08em' }}>YOU OWE</p>
              {(() => { const [w, c] = splitMoney(total); return <Money whole={w} cents={c} size={26} color={total > 0 ? TOK.text : TOK.textFaint} />; })()}
            </div>
            <button
              disabled={!hasClaims}
              onClick={submitPay}
              style={{
                flex: 1.4, padding: '14px 20px',
                background: hasClaims ? TOK.accent : TOK.surface,
                color: hasClaims ? TOK.accentInk : TOK.textFaint,
                border: hasClaims ? 'none' : `1px solid ${TOK.border}`,
                borderRadius: 14,
                fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700,
                cursor: hasClaims ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                boxShadow: hasClaims ? `0 12px 32px ${TOK.accent}30` : 'none',
              }}
            >
              Pay with bunq {hasClaims && ICN.arrow(TOK.accentInk)}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function Centered({ children, text }: { children?: React.ReactNode; text?: string }) {
  return (
    <main style={{
      minHeight: '100vh', background: TOK.bg, color: TOK.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        {text ? <p style={{ fontSize: 14, color: TOK.textDim }}>{text}</p> : children}
      </div>
    </main>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-block', marginTop: 20,
  padding: '14px 24px',
  background: TOK.accent, color: TOK.accentInk,
  border: 'none', borderRadius: 12,
  fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, cursor: 'pointer',
};

const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  background: TOK.surface, border: `1px solid ${TOK.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: TOK.text, cursor: 'pointer',
};
