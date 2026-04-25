'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Receipt, LineItem } from '@/lib/types/receipt';

const TEAL = '#00E5A0';
const MAX_SHARE = 6;

interface SessionView {
  id: string;
  receipt: Receipt;
  hostName: string;
  invitees: { id: string; name: string; status: string }[];
}

type Screen = 'loading' | 'receipt' | 'paying' | 'done' | 'skipped' | 'error' | 'expired';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<SessionView | null>(null);
  const [me, setMe] = useState<{ id: string; name: string; status: string } | null>(null);
  // claims[itemId] = sharedWith count (0 = not claimed, 1 = solo, 2+ = shared with N)
  const [claims, setClaims] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/session/${params.sessionId}`)
      .then(async (res) => {
        if (res.status === 404) {
          setScreen('expired');
          return;
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data: SessionView = await res.json();
        setSession(data);
        const invitee = data.invitees.find((i) => i.id === params.inviteeId);
        if (!invitee) {
          setScreen('expired');
          return;
        }
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

  const total = useMemo(
    () => (session ? computeTotal(session.receipt, claims) : 0),
    [session, claims]
  );

  const hasClaims = Object.values(claims).some((v) => v > 0);

  const cycleClaim = (itemId: number) => {
    setClaims((prev) => {
      const cur = prev[itemId] ?? 0;
      const next = cur >= MAX_SHARE ? 0 : cur + 1;
      return { ...prev, [itemId]: next };
    });
  };

  const submitPay = async () => {
    if (!session || !me) return;
    setScreen('paying');
    const claimsArray = Object.entries(claims)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ itemId: Number(k), sharedWith: v }));
    try {
      const res = await fetch(`/api/session/${params.sessionId}/${params.inviteeId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claims: claimsArray }),
      });
      const data = await res.json();
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
      const res = await fetch(`/api/session/${params.sessionId}/${params.inviteeId}/skip`, {
        method: 'POST',
      });
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

  // ── LOADING / EXPIRED / ERROR ──────────────────────────────────────────────

  if (screen === 'loading') return (
    <main style={s.page}><div style={s.card}><p style={s.sub}>Loading receipt…</p></div></main>
  );

  if (screen === 'expired') return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⌛</div>
        <h2 style={s.title}>Link expired</h2>
        <p style={s.sub}>This invite link is no longer valid.</p>
      </div>
    </main>
  );

  if (screen === 'error') return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <h2 style={s.title}>Something went wrong</h2>
        <p style={s.error}>{error}</p>
        <button style={s.btn} onClick={() => setScreen('receipt')}>Try Again</button>
      </div>
    </main>
  );

  // ── PAYING ────────────────────────────────────────────────────────────────

  if (screen === 'paying') return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💸</div>
        <h2 style={s.title}>Paying via bunq…</h2>
        <p style={s.sub}>Just a moment</p>
      </div>
    </main>
  );

  // ── DONE ──────────────────────────────────────────────────────────────────

  if (screen === 'done' && session && me) return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
        <h2 style={s.title}>Paid!</h2>
        <p style={s.sub}>
          {paidAmount != null
            ? `${formatAmount(paidAmount, session.receipt.currency)} sent to ${session.hostName}`
            : `Paid to ${session.hostName}`}
        </p>
        <p style={{ fontSize: 13, color: '#aaa', marginTop: 16 }}>You can close this tab.</p>
      </div>
    </main>
  );

  if (screen === 'skipped' && session) return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>👋</div>
        <h2 style={s.title}>No problem</h2>
        <p style={s.sub}>You haven't been charged. Thanks!</p>
      </div>
    </main>
  );

  // ── RECEIPT (main) ────────────────────────────────────────────────────────

  if (screen === 'receipt' && session && me) return (
    <main style={{ ...s.page, alignItems: 'flex-start', paddingTop: 24, paddingBottom: 120 }}>
      <div style={{ ...s.card, maxWidth: 540, textAlign: 'left' }}>

        <p style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>Hi {me.name} 👋</p>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
          {session.hostName} wants to split {session.receipt.merchant ?? 'a receipt'}
        </h2>
        <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
          Tap items you had. Tap again to share with more people.
        </p>

        <div style={{
          background: '#f8faf8', borderRadius: 10, padding: '10px 14px',
          fontSize: 13, color: '#555', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Receipt total</span>
            <span style={{ fontWeight: 700 }}>{formatAmount(session.receipt.total, session.receipt.currency)}</span>
          </div>
        </div>

        {session.receipt.items.map((item: LineItem) => {
          const share = claims[item.id] ?? 0;
          const myCost = share > 0 ? item.line_total / share : 0;
          const claimed = share > 0;
          return (
            <button
              key={item.id}
              onClick={() => cycleClaim(item.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '14px 16px',
                marginBottom: 8,
                borderRadius: 12,
                border: claimed ? `2px solid ${TEAL}` : '2px solid #eee',
                background: claimed ? '#f0fff8' : '#fff',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {item.description}
                  {item.quantity > 1 && <span style={{ color: '#999', fontWeight: 400 }}> ×{item.quantity}</span>}
                </span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{formatAmount(item.line_total, session.receipt.currency)}</span>
              </div>
              {claimed && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: TEAL, fontWeight: 700 }}>
                    {share === 1 ? 'All mine' : `Shared ${share} ways`}
                  </span>
                  <span style={{ fontSize: 13, color: '#333' }}>
                    Your share: <strong>{formatAmount(myCost, session.receipt.currency)}</strong>
                  </span>
                </div>
              )}
            </button>
          );
        })}

        {session.receipt.tax > 0 && (
          <p style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>
            Tax & tip distributed proportionally to what you claim.
          </p>
        )}

        <button
          onClick={submitSkip}
          style={{
            display: 'block', width: '100%', marginTop: 16,
            padding: '10px', background: 'transparent', color: '#888',
            border: '1px solid #ddd', borderRadius: 10, fontSize: 13,
            cursor: 'pointer',
          }}
        >
          I had nothing
        </button>
      </div>

      {/* Sticky bottom pay bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #eee',
        padding: '14px 16px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>You owe</p>
            <p style={{ fontSize: 22, fontWeight: 800 }}>{formatAmount(total, session.receipt.currency)}</p>
          </div>
          <button
            disabled={!hasClaims}
            onClick={submitPay}
            style={{
              flex: 1.4,
              padding: '14px 20px',
              background: hasClaims ? TEAL : '#ddd',
              color: hasClaims ? '#000' : '#999',
              border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700,
              cursor: hasClaims ? 'pointer' : 'not-allowed',
            }}
          >
            Pay with bunq
          </button>
        </div>
      </div>
    </main>
  );

  return null;
}

// ── STYLES ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f4f4f4',
    padding: 16,
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 440,
    boxShadow: '0 4px 32px rgba(0,0,0,0.07)',
    textAlign: 'center' as const,
  },
  title: { fontSize: 24, fontWeight: 800, marginBottom: 8 },
  sub: { fontSize: 14, color: '#888', marginBottom: 16 },
  error: { color: '#ef4444', fontSize: 13, marginBottom: 16 },
  btn: {
    display: 'block', width: '100%',
    padding: '14px 20px',
    background: TEAL, color: '#000',
    border: 'none', borderRadius: 12,
    fontSize: 16, fontWeight: 700, cursor: 'pointer',
  },
};
