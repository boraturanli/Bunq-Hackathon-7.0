'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Receipt, LineItem } from '@/lib/types/receipt';

// ── Palette (matches host page) ───────────────────────────────────────────────
const C = {
  bg:        '#0A0A0A',
  surface:   '#141414',
  surface2:  '#1C1C1C',
  surface3:  '#252525',
  border:    'rgba(255,255,255,0.06)',
  borderMd:  'rgba(255,255,255,0.10)',
  orange:    '#FF6B00',
  orangeDim: 'rgba(255,107,0,0.12)',
  orangeSel: 'rgba(255,107,0,0.08)',
  green:     '#00E5A0',
  greenDim:  'rgba(0,229,160,0.10)',
  text:      '#FFFFFF',
  text2:     'rgba(255,255,255,0.50)',
  text3:     'rgba(255,255,255,0.26)',
  red:       '#FF4D4D',
} as const;

const MAX_SHARE = 6;

interface SessionView {
  id: string;
  receipt: Receipt;
  hostName: string;
  invitees: { id: string; name: string; status: string }[];
}

type Screen = 'loading' | 'receipt' | 'paying' | 'done' | 'skipped' | 'error' | 'expired';

const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n);

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

// ── Shared styles ─────────────────────────────────────────────────────────────
const bigBtn: React.CSSProperties = {
  display: 'block', width: '100%',
  padding: '19px 24px', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
  background: C.orange, color: '#000',
  border: 'none', borderRadius: 16, cursor: 'pointer', textAlign: 'center',
};

const spinStyle: React.CSSProperties = {
  width: 17, height: 17, borderRadius: 9999,
  border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000',
  display: 'inline-block', flexShrink: 0,
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function InviteePage({ params }: { params: { sessionId: string; inviteeId: string } }) {
  const [screen,     setScreen]     = useState<Screen>('loading');
  const [session,    setSession]    = useState<SessionView | null>(null);
  const [me,         setMe]         = useState<{ id: string; name: string; status: string } | null>(null);
  const [claims,     setClaims]     = useState<Record<number, number>>({});
  const [error,      setError]      = useState<string | null>(null);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/session/${params.sessionId}`)
      .then(async res => {
        if (res.status === 404) { setScreen('expired'); return; }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data: SessionView = await res.json();
        setSession(data);
        const invitee = data.invitees.find(i => i.id === params.inviteeId);
        if (!invitee) { setScreen('expired'); return; }
        setMe(invitee);
        if (invitee.status === 'paid') setScreen('done');
        else if (invitee.status === 'skipped') setScreen('skipped');
        else setScreen('receipt');
      })
      .catch(e => { setError(e instanceof Error ? e.message : 'Failed to load'); setScreen('error'); });
  }, [params.sessionId, params.inviteeId]);

  const total    = useMemo(() => session ? computeTotal(session.receipt, claims) : 0, [session, claims]);
  const hasClaims = Object.values(claims).some(v => v > 0);

  const cycleClaim = (itemId: number) =>
    setClaims(prev => ({ ...prev, [itemId]: ((prev[itemId] ?? 0) >= MAX_SHARE ? 0 : (prev[itemId] ?? 0) + 1) }));

  const submitPay = async () => {
    if (!session || !me) return;
    setScreen('paying');
    const claimsArray = Object.entries(claims)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ itemId: Number(k), sharedWith: v }));
    try {
      const res  = await fetch(`/api/session/${params.sessionId}/${params.inviteeId}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/session/${params.sessionId}/${params.inviteeId}/skip`, { method: 'POST' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? 'Skip failed'); }
      setScreen('skipped');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Skip failed');
      setScreen('error');
    }
  };

  // ── Splash states ─────────────────────────────────────────────────────────

  if (screen === 'loading') return <Splash icon={<Spinner />} title="Loading" sub="Fetching receipt…" />;

  if (screen === 'expired') return <Splash icon="⌛" title="Link expired" sub="This invite is no longer active." />;

  if (screen === 'error') return (
    <Splash
      icon="⚠"
      title="Something went wrong"
      sub={error ?? 'Unknown error'}
      action={{ label: 'Try again', onClick: () => setScreen('receipt') }}
    />
  );

  if (screen === 'paying') return (
    <Splash icon={<Spinner size={56} />} title="Sending payment…" sub="Connecting to bunq" />
  );

  if (screen === 'done' && session) return (
    <main style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: `linear-gradient(170deg, #0A0E0C 0%, ${C.bg} 50%)`,
      padding: '48px 28px',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        border: `2px solid ${C.green}`, background: C.greenDim,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, marginBottom: 28,
        boxShadow: '0 0 40px rgba(0,229,160,0.12)',
      }}>✓</div>
      <p style={{ fontSize: 12, color: C.text3, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        Payment sent
      </p>
      {paidAmount != null && (
        <p style={{ fontSize: 60, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, color: C.green, marginBottom: 12 }}>
          {fmt(paidAmount, session.receipt.currency)}
        </p>
      )}
      <p style={{ fontSize: 15, color: C.text2 }}>
        Paid to {session.hostName}
      </p>
      <p style={{ fontSize: 12, color: C.text3, marginTop: 32 }}>You can close this tab.</p>
    </main>
  );

  if (screen === 'skipped' && session) return (
    <main style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: C.bg, padding: '48px 28px',
    }}>
      <div style={{ fontSize: 52, marginBottom: 24 }}>👋</div>
      <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.035em', color: C.text, marginBottom: 10 }}>No worries</h2>
      <p style={{ fontSize: 15, color: C.text2 }}>You haven't been charged.</p>
      <p style={{ fontSize: 12, color: C.text3, marginTop: 32 }}>You can close this tab.</p>
    </main>
  );

  // ── Receipt (main) ────────────────────────────────────────────────────────

  if (screen === 'receipt' && session && me) {
    const currency = session.receipt.currency;
    return (
      <main className="app-screen" style={{ background: C.bg }}>

        {/* Sticky header */}
        <div className="app-bar" style={{ padding: '18px 24px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.text3, marginBottom: 2 }}>
            Hi {me.name} · {session.hostName} wants to split
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', color: C.text, lineHeight: 1 }}>
              {session.receipt.merchant ?? 'Receipt'}
            </h2>
            <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.04em', color: C.text2 }}>
              {fmt(session.receipt.total, currency)}
            </span>
          </div>
        </div>

        {/* Instructions */}
        <div style={{ padding: '16px 24px 0', borderBottom: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 13, color: C.text3, paddingBottom: 14 }}>
            Tap items you ordered — tap again to split with others (up to {MAX_SHARE}).
          </p>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 140px' }}>
          {session.receipt.items.map((item: LineItem) => {
            const share   = claims[item.id] ?? 0;
            const myCost  = share > 0 ? item.line_total / share : null;
            const claimed = share > 0;
            return (
              <button key={item.id} onClick={() => cycleClaim(item.id)} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '16px 0', cursor: 'pointer',
                background: 'none', border: 'none',
                borderBottom: `1px solid ${claimed ? 'rgba(255,107,0,0.18)' : C.border}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  {/* Claim indicator */}
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    background: claimed ? C.orange : C.surface3,
                    border: `1.5px solid ${claimed ? C.orange : C.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 900, color: claimed ? '#000' : C.text3,
                    transition: 'all 0.12s',
                  }}>
                    {claimed ? (share === 1 ? '✓' : share) : ''}
                  </div>

                  <span style={{ flex: 1, fontSize: 15, fontWeight: claimed ? 700 : 400, color: claimed ? C.text : C.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.description}
                    {item.quantity > 1 && <span style={{ color: C.text3, fontWeight: 400 }}> ×{item.quantity}</span>}
                  </span>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 800, color: claimed ? C.orange : C.text, lineHeight: 1 }}>
                      {myCost != null ? fmt(myCost, currency) : fmt(item.line_total, currency)}
                    </p>
                    {claimed && share > 1 && (
                      <p style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>÷{share} ways</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {session.receipt.tax > 0 && (
            <p style={{ fontSize: 12, color: C.text3, padding: '16px 0' }}>
              Tax &amp; tip are split proportionally to what you claim.
            </p>
          )}
        </div>

        {/* Sticky bottom bar */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'rgba(10,10,10,0.97)', backdropFilter: 'blur(24px)',
          borderTop: `1px solid ${C.borderMd}`,
          padding: '16px 24px 32px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 11, fontWeight: 800, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                Your total
              </p>
              <p style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: hasClaims ? C.text : C.text3 }}>
                {hasClaims ? fmt(total, currency) : '—'}
              </p>
            </div>
            <button
              disabled={!hasClaims}
              onClick={submitPay}
              style={{
                ...bigBtn, flex: 1.2,
                background: hasClaims ? C.orange : C.surface3,
                color: hasClaims ? '#000' : C.text3,
                cursor: hasClaims ? 'pointer' : 'not-allowed',
                opacity: 1,
              }}
            >
              Pay with bunq
            </button>
          </div>

          <button onClick={submitSkip} style={{
            display: 'block', width: '100%',
            padding: '11px', background: 'transparent',
            border: `1px solid ${C.border}`, borderRadius: 10,
            fontSize: 13, fontWeight: 700, color: C.text3, cursor: 'pointer',
          }}>
            I had nothing — skip me
          </button>
        </div>
      </main>
    );
  }

  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner({ size = 40 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `${size > 30 ? 3 : 2}px solid ${C.surface3}`,
      borderTopColor: C.orange,
    }} className="spin" />
  );
}

function Splash({
  icon, title, sub, action,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: C.bg, padding: '48px 28px', textAlign: 'center',
    }}>
      <div style={{ marginBottom: 24, fontSize: 48, lineHeight: 1 }}>{icon}</div>
      <h2 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.035em', color: C.text, marginBottom: 10 }}>{title}</h2>
      <p style={{ fontSize: 15, color: C.text2, maxWidth: 280, lineHeight: 1.65 }}>{sub}</p>
      {action && (
        <button onClick={action.onClick} style={{
          marginTop: 32, padding: '16px 32px',
          background: C.orange, color: '#000',
          border: 'none', borderRadius: 14,
          fontSize: 15, fontWeight: 800, cursor: 'pointer',
        }}>{action.label}</button>
      )}
    </main>
  );
}
