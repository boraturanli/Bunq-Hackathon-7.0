'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Receipt } from '@/lib/types/receipt';
import { MOCK_USERS, type MockUser } from '@/lib/users';

const TEAL = '#00E5A0';

interface CreatedInvitee {
  id: string;
  userId: string;
  name: string;
}

interface InviteeStatus {
  id: string;
  name: string;
  status: 'pending' | 'paid' | 'skipped';
  claims: { itemId: number; sharedWith: number }[];
  amountPaid?: number;
  paidAt?: number;
}

type Screen = 'capture' | 'people' | 'tracking' | 'done';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('capture');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [hostName, setHostName] = useState('');
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [invitees, setInvitees] = useState<CreatedInvitee[]>([]);
  const [statuses, setStatuses] = useState<InviteeStatus[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll status while tracking
  useEffect(() => {
    if (screen !== 'tracking' || !sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStatuses(data.invitees);
        const allDone = data.invitees.every((i: InviteeStatus) => i.status !== 'pending');
        if (allDone && data.invitees.length > 0) setScreen('done');
      } catch {/* ignore */}
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [screen, sessionId]);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append('image', file);
    try {
      const res = await fetch('/api/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Parse failed');
      setReceipt(data);
      setScreen('people');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePick = (userId: string) => {
    setPickedIds((p) => (p.includes(userId) ? p.filter((x) => x !== userId) : [...p, userId]));
  };

  const sendInvites = async () => {
    if (!receipt || pickedIds.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt,
          hostName: hostName.trim() || 'Your friend',
          inviteeUserIds: pickedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create session');
      setSessionId(data.sessionId);
      setInvitees(data.invitees);
      setScreen('tracking');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setCreating(false);
    }
  };

  const reset = () => {
    setScreen('capture');
    setReceipt(null);
    setHostName('');
    setPickedIds([]);
    setSessionId(null);
    setInvitees([]);
    setStatuses([]);
    setExpanded(null);
  };

  // ── CAPTURE ───────────────────────────────────────────────────────────────

  if (screen === 'capture') return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🧾</div>
        <h1 style={s.title}>SnapSplit</h1>
        <p style={s.sub}>Snap a receipt — your friends pick what they had and pay you back</p>
        {error && <p style={s.error}>{error}</p>}
        <button
          style={{ ...s.btn, opacity: loading ? 0.6 : 1 }}
          disabled={loading}
          onClick={() => fileRef.current?.click()}
        >
          {loading ? 'Reading receipt…' : '📷  Scan Receipt'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>
    </main>
  );

  // ── PEOPLE (pick mock users) ──────────────────────────────────────────────

  if (screen === 'people' && receipt) return (
    <main style={{ ...s.page, alignItems: 'flex-start', paddingTop: 24 }}>
      <div style={{ ...s.card, maxWidth: 540, textAlign: 'left' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{receipt.merchant ?? 'Receipt'}</h2>
          <span style={{ fontSize: 22, fontWeight: 800, color: TEAL }}>
            {formatAmount(receipt.total, receipt.currency)}
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>
          {receipt.items.length} item{receipt.items.length === 1 ? '' : 's'}
          {receipt.warning && <span style={{ color: '#f59e0b' }}> · totals don't match</span>}
        </p>

        <div style={s.divider} />

        <p style={s.label}>YOUR NAME</p>
        <input
          style={{ ...s.input, width: '100%', marginBottom: 20 }}
          placeholder="So they know who's asking"
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
        />

        <p style={s.label}>SPLIT WITH</p>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Tap to choose. They'll get a notification in their bunq inbox.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {MOCK_USERS.map((u: MockUser) => {
            const picked = pickedIds.includes(u.id);
            return (
              <button
                key={u.id}
                onClick={() => togglePick(u.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  background: picked ? '#f0fff8' : '#fff',
                  border: picked ? `2px solid ${TEAL}` : '2px solid #eee',
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: u.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 800, color: '#000',
                  flexShrink: 0,
                }}>
                  {u.name[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{u.name}</p>
                  <p style={{ fontSize: 12, color: '#999' }}>{u.email}</p>
                </div>
                {picked && (
                  <span style={{
                    fontSize: 18, color: TEAL, fontWeight: 800,
                  }}>✓</span>
                )}
              </button>
            );
          })}
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button
          style={{ ...s.btn, opacity: pickedIds.length === 0 || creating ? 0.4 : 1 }}
          disabled={pickedIds.length === 0 || creating}
          onClick={sendInvites}
        >
          {creating
            ? 'Notifying…'
            : pickedIds.length === 0
              ? 'Choose someone above'
              : `Notify ${pickedIds.length} ${pickedIds.length === 1 ? 'friend' : 'friends'}`}
        </button>
      </div>
    </main>
  );

  // ── TRACKING ──────────────────────────────────────────────────────────────

  if (screen === 'tracking' && receipt && sessionId) return (
    <main style={{ ...s.page, alignItems: 'flex-start', paddingTop: 24 }}>
      <div style={{ ...s.card, maxWidth: 540, textAlign: 'left' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Waiting for friends</h2>
          <span style={{ fontSize: 12, color: '#888' }}>
            {statuses.filter((x) => x.status !== 'pending').length}/{statuses.length} done
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          {receipt.merchant ?? 'Receipt'} · {formatAmount(receipt.total, receipt.currency)}
        </p>

        <div style={{
          background: '#f0fff8', border: `1px solid ${TEAL}`, borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#006d3a',
        }}>
          ✓ Notifications sent. Updates appear here as each friend reviews and pays.
        </div>

        {invitees.map((inv) => {
          const status = statuses.find((x) => x.id === inv.id);
          const state = status?.status ?? 'pending';
          const user = MOCK_USERS.find((u) => u.id === inv.userId);
          const isExpanded = expanded === inv.id;
          return (
            <div key={inv.id} style={{
              padding: '12px 14px', marginBottom: 8,
              background: '#fff', border: '1px solid #eee', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: user?.color ?? '#eee',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, color: '#000',
                  flexShrink: 0,
                }}>
                  {inv.name[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{inv.name}</p>
                  <p style={{ fontSize: 11, color: '#999' }}>
                    {state === 'pending' && '⏳ Waiting…'}
                    {state === 'paid' && status?.paidAt && `Paid · just now`}
                    {state === 'skipped' && 'Had nothing'}
                  </p>
                </div>
                <StatusChip state={state} amount={status?.amountPaid} currency={receipt.currency} />
              </div>

              {state === 'paid' && status && (
                <>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : inv.id)}
                    style={{
                      marginTop: 8, background: 'transparent', border: 'none',
                      color: TEAL, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
                    }}
                  >
                    {isExpanded ? '▾ Hide breakdown' : '▸ See what they paid for'}
                  </button>
                  {isExpanded && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#555', paddingLeft: 4 }}>
                      {status.claims.length === 0 ? (
                        <p style={{ color: '#999' }}>No items</p>
                      ) : (
                        status.claims.map((c) => {
                          const item = receipt.items.find((i) => i.id === c.itemId);
                          if (!item) return null;
                          const cost = item.line_total / Math.max(1, c.sharedWith);
                          return (
                            <div key={c.itemId} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                              <span>
                                {item.description}
                                {c.sharedWith > 1 && <span style={{ color: '#999' }}> ÷{c.sharedWith}</span>}
                              </span>
                              <span>{formatAmount(cost, receipt.currency)}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        <button
          onClick={reset}
          style={{
            display: 'block', width: '100%', marginTop: 16,
            padding: '10px', background: 'transparent', color: '#888',
            border: '1px solid #ddd', borderRadius: 10, fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Start over
        </button>
      </div>
    </main>
  );

  // ── DONE ──────────────────────────────────────────────────────────────────

  if (screen === 'done' && receipt) {
    const collected = statuses
      .filter((x) => x.status === 'paid')
      .reduce((sum, x) => sum + (x.amountPaid ?? 0), 0);
    return (
      <main style={s.page}>
        <div style={{ ...s.card, maxWidth: 480 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h2 style={{ ...s.title, fontSize: 24 }}>All done!</h2>
          <p style={s.sub}>
            Collected {formatAmount(collected, receipt.currency)} of {formatAmount(receipt.total, receipt.currency)}
          </p>

          <div style={{ textAlign: 'left', marginTop: 16 }}>
            {statuses.map((x) => (
              <div key={x.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid #f0f0f0',
              }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{x.name}</span>
                <StatusChip state={x.status} amount={x.amountPaid} currency={receipt.currency} />
              </div>
            ))}
          </div>

          <button style={{ ...s.btn, marginTop: 20 }} onClick={reset}>
            Split Another
          </button>
        </div>
      </main>
    );
  }

  return null;
}

function StatusChip({ state, amount, currency }: {
  state: 'pending' | 'paid' | 'skipped';
  amount?: number;
  currency: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    pending: { background: '#fff7e6', color: '#a65b00', border: '1px solid #ffd591' },
    paid:    { background: '#f0fff8', color: '#006d3a', border: `1px solid ${TEAL}` },
    skipped: { background: '#f5f5f5', color: '#666', border: '1px solid #ddd' },
  };
  const labels: Record<string, string> = {
    pending: 'Pending',
    paid: amount != null ? `Paid · ${new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)}` : 'Paid',
    skipped: 'Skipped',
  };
  return (
    <span style={{
      ...styles[state],
      fontSize: 11, fontWeight: 700,
      padding: '4px 10px', borderRadius: 12,
      whiteSpace: 'nowrap',
    }}>{labels[state]}</span>
  );
}

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
    padding: 32,
    width: '100%',
    maxWidth: 440,
    boxShadow: '0 4px 32px rgba(0,0,0,0.07)',
    textAlign: 'center' as const,
  },
  title: { fontSize: 30, fontWeight: 800, marginBottom: 8 },
  sub: { fontSize: 15, color: '#999', marginBottom: 28 },
  error: { color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'left' as const },
  btn: {
    display: 'block', width: '100%',
    padding: '14px 20px',
    background: TEAL, color: '#000',
    border: 'none', borderRadius: 12,
    fontSize: 16, fontWeight: 700, cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  input: {
    flex: 1,
    border: '1.5px solid #e5e5e5',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    minWidth: 0,
    background: '#fafafa',
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: '#aaa',
    letterSpacing: '0.08em',
    marginBottom: 10,
  },
  divider: {
    height: 1,
    background: '#f0f0f0',
    margin: '16px 0',
  },
};
