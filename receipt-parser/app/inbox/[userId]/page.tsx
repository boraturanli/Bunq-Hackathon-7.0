'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const TEAL = '#00E5A0';

interface InboxItem {
  sessionId: string;
  inviteeId: string;
  hostName: string;
  merchant: string | null;
  currency: string;
  total: number;
  itemCount: number;
  createdAt: number;
  status: 'pending' | 'paid' | 'skipped';
  amountPaid?: number;
}

interface InboxResponse {
  user: { id: string; name: string; email: string; color: string };
  items: InboxItem[];
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function InboxPage({ params }: { params: { userId: string } }) {
  const router = useRouter();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<InboxItem | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/inbox/${params.userId}`, { cache: 'no-store' });
        if (res.status === 404) {
          if (!cancelled) setError('User not found');
          return;
        }
        if (!res.ok) return;
        const fresh: InboxResponse = await res.json();
        if (cancelled) return;
        setData(fresh);

        // Detect newly arrived pending sessions
        const currentPendingIds = new Set(
          fresh.items.filter((i) => i.status === 'pending').map((i) => i.sessionId)
        );
        if (firstLoadRef.current) {
          // Seed seen set with whatever was already there
          currentPendingIds.forEach((id) => seenRef.current.add(id));
          firstLoadRef.current = false;
        } else {
          for (const item of fresh.items) {
            if (item.status === 'pending' && !seenRef.current.has(item.sessionId)) {
              seenRef.current.add(item.sessionId);
              setPopup(item); // show notification for the new one
            }
          }
          // Also seed any non-pending so we don't re-fire if it goes back to pending (won't, but safe)
          fresh.items.forEach((i) => seenRef.current.add(i.sessionId));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [params.userId]);

  const openSplit = (item: InboxItem) => {
    setPopup(null);
    router.push(`/split/${item.sessionId}/${item.inviteeId}?inbox=${params.userId}`);
  };

  if (error) return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <h2 style={s.title}>{error}</h2>
        <p style={s.sub}>Try /inbox/alice, /inbox/bob, /inbox/carol or /inbox/dave</p>
      </div>
    </main>
  );

  if (!data) return (
    <main style={s.page}><div style={s.card}><p style={s.sub}>Loading…</p></div></main>
  );

  const pending = data.items.filter((i) => i.status === 'pending');
  const past = data.items.filter((i) => i.status !== 'pending');

  return (
    <main style={{ ...s.page, alignItems: 'flex-start', paddingTop: 0, padding: 0, background: '#fff' }}>
      <div style={{ width: '100%', maxWidth: 480, minHeight: '100vh', background: '#fff' }}>

        {/* Header — bunq style */}
        <div style={{
          background: data.user.color,
          padding: '24px 20px 60px',
          color: '#000',
          position: 'relative',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 800, color: data.user.color,
            }}>
              {data.user.name[0]}
            </div>
            <div>
              <p style={{ fontSize: 13, opacity: 0.7 }}>Signed in as</p>
              <h1 style={{ fontSize: 22, fontWeight: 800 }}>{data.user.name}</h1>
              <p style={{ fontSize: 12, opacity: 0.7 }}>{data.user.email}</p>
            </div>
          </div>
        </div>

        {/* Inbox card overlapping header */}
        <div style={{
          marginTop: -36, padding: '0 16px',
        }}>
          <div style={{
            background: '#fff', borderRadius: 16,
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            padding: 20,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800 }}>Inbox</h2>
              {pending.length > 0 && (
                <span style={{
                  background: TEAL, color: '#000',
                  fontSize: 11, fontWeight: 800,
                  padding: '3px 10px', borderRadius: 10,
                }}>
                  {pending.length} new
                </span>
              )}
            </div>

            {data.items.length === 0 && (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📬</div>
                <p style={{ fontSize: 14, color: '#999' }}>No messages yet</p>
                <p style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>
                  Waiting for a friend to send you a receipt…
                </p>
              </div>
            )}

            {pending.map((item) => (
              <button
                key={item.sessionId}
                onClick={() => openSplit(item)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '14px', marginBottom: 8,
                  background: '#f0fff8', border: `2px solid ${TEAL}`, borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>
                    💸 {item.hostName} wants to split
                  </p>
                  <span style={{ fontSize: 11, color: '#666' }}>{timeAgo(item.createdAt)}</span>
                </div>
                <p style={{ fontSize: 13, color: '#333', marginTop: 4 }}>
                  {item.merchant ?? 'Receipt'} · {formatAmount(item.total, item.currency)} · {item.itemCount} items
                </p>
                <p style={{ fontSize: 12, color: TEAL, fontWeight: 700, marginTop: 6 }}>
                  Tap to review →
                </p>
              </button>
            ))}

            {past.length > 0 && (
              <>
                {pending.length > 0 && <div style={{ height: 1, background: '#eee', margin: '12px 0' }} />}
                <p style={{
                  fontSize: 11, fontWeight: 700, color: '#aaa',
                  letterSpacing: '0.06em', marginBottom: 8,
                }}>EARLIER</p>
                {past.map((item) => (
                  <div key={item.sessionId} style={{
                    padding: '12px 14px', marginBottom: 6,
                    background: '#fafafa', border: '1px solid #eee', borderRadius: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <p style={{ fontSize: 13, fontWeight: 600 }}>
                        {item.hostName} · {item.merchant ?? 'Receipt'}
                      </p>
                      <span style={{ fontSize: 11, color: '#999' }}>{timeAgo(item.createdAt)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: '#666' }}>
                        {formatAmount(item.total, item.currency)} total
                      </span>
                      {item.status === 'paid' ? (
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          background: '#f0fff8', color: '#006d3a',
                          padding: '3px 10px', borderRadius: 10,
                          border: `1px solid ${TEAL}`,
                        }}>
                          ✓ Paid {item.amountPaid != null ? formatAmount(item.amountPaid, item.currency) : ''}
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          background: '#f5f5f5', color: '#666',
                          padding: '3px 10px', borderRadius: 10,
                        }}>
                          Skipped
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div style={{ height: 40 }} />
      </div>

      {/* Notification popup */}
      {popup && (
        <div
          onClick={() => setPopup(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: 60, padding: 16,
            zIndex: 50, animation: 'fadeIn 0.2s',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 18,
              padding: 24, maxWidth: 380, width: '100%',
              boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
              animation: 'slideDown 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, fontWeight: 800, color: TEAL,
              letterSpacing: '0.08em', marginBottom: 12,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: TEAL,
                animation: 'pulse 1.2s infinite',
              }} />
              NEW REQUEST · BUNQ
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              💸 {popup.hostName} needs you
            </h3>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
              Asking you to chip in for <strong>{popup.merchant ?? 'a receipt'}</strong>
            </p>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
              Total: {formatAmount(popup.total, popup.currency)} · {popup.itemCount} items
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setPopup(null)}
                style={{
                  flex: 1, padding: '12px',
                  background: '#f0f0f0', color: '#666',
                  border: 'none', borderRadius: 10,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Later
              </button>
              <button
                onClick={() => openSplit(popup)}
                style={{
                  flex: 2, padding: '12px',
                  background: TEAL, color: '#000',
                  border: 'none', borderRadius: 10,
                  fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}
              >
                Review receipt →
              </button>
            </div>
          </div>
          <style>{`
            @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes slideDown {
              from { transform: translateY(-30px); opacity: 0 }
              to   { transform: translateY(0);     opacity: 1 }
            }
            @keyframes pulse {
              0%   { opacity: 1; transform: scale(1) }
              50%  { opacity: 0.4; transform: scale(1.4) }
              100% { opacity: 1; transform: scale(1) }
            }
          `}</style>
        </div>
      )}
    </main>
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
  title: { fontSize: 24, fontWeight: 800, marginBottom: 8 },
  sub: { fontSize: 14, color: '#888' },
};
