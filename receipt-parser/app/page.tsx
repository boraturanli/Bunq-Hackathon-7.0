'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Receipt } from '@/lib/types/receipt';

const TEAL = '#00E5A0';

interface TopFriend {
  id: string;
  name: string;
  email: string;
  color: string;
  iban: string | null;
  pointer_type: string;
  pointer_value: string;
  transaction_count: number;
}

interface PickedPerson {
  name: string;
  email: string;
  color: string;
  source: 'top-friend' | 'custom';
}

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

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

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
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [invitees, setInvitees] = useState<CreatedInvitee[]>([]);
  const [statuses, setStatuses] = useState<InviteeStatus[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [topFriends, setTopFriends] = useState<TopFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

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

  const openPanel = async () => {
    setPanelOpen(true);
    setFriendsLoading(true);
    setFriendsError(false);
    try {
      const res = await fetch('/api/contacts/top?n=5', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setTopFriends(await res.json());
    } catch {
      setFriendsError(true);
    } finally {
      setFriendsLoading(false);
    }
  };

  const closePanel = () => {
    setPanelOpen(false);
    setShowAddForm(false);
    setNewName('');
    setNewEmail('');
  };

  const toggleFriend = (f: TopFriend) => {
    setPicked((prev) => {
      const exists = prev.find((p) => p.email === f.email);
      if (exists) return prev.filter((p) => p.email !== f.email);
      return [...prev, { name: f.name, email: f.email, color: f.color, source: 'top-friend' }];
    });
  };

  const addCustom = () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setPicked((prev) => {
      if (prev.find((p) => p.email === newEmail.trim())) return prev;
      return [...prev, {
        name: newName.trim(),
        email: newEmail.trim(),
        color: '',  // server-side colorFor() will assign
        source: 'custom',
      }];
    });
    setNewName('');
    setNewEmail('');
    setShowAddForm(false);
  };

  const removePicked = (email: string) => {
    setPicked((prev) => prev.filter((p) => p.email !== email));
  };

  const sendInvites = async () => {
    if (!receipt || picked.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt,
          hostName: hostName.trim() || 'Your friend',
          invitees: picked.map((p) => ({
            name: p.name,
            email: p.email,
            color: p.color || undefined,
            source: p.source,
          })),
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
    setPicked([]);
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
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #eee' }}>
          <a href="/inbox" target="_blank" rel="noopener noreferrer" style={{ color: '#888', fontSize: 12, textDecoration: 'none' }}>
            Demo lobby — set up inbox tabs →
          </a>
        </div>
      </div>
    </main>
  );

  // ── PEOPLE ────────────────────────────────────────────────────────────────

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

        <p style={s.label}>WHO'S AT THE TABLE</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {picked.map((p) => (
            <div key={p.email} style={{
              ...s.chip,
              display: 'flex', alignItems: 'center', gap: 8,
              paddingLeft: 4,
            }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                background: p.color || TEAL,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: '#000',
              }}>
                {initials(p.name)}
              </span>
              {p.name}
              <span onClick={() => removePicked(p.email)} style={{ cursor: 'pointer', color: '#999', fontSize: 12, paddingRight: 4 }}>✕</span>
            </div>
          ))}
          <button onClick={openPanel} style={{
            ...s.chip, background: TEAL, color: '#000', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add People
          </button>
        </div>

        <div style={{
          background: '#f8faf8', borderRadius: 10, padding: '10px 14px',
          marginBottom: 20, fontSize: 12, color: '#666',
        }}>
          They'll get a notification in their bunq inbox — open the lobby <a href="/inbox" target="_blank" style={{ color: TEAL, fontWeight: 700 }}>here</a> to pre-stage tabs.
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button
          style={{ ...s.btn, opacity: picked.length === 0 || creating ? 0.4 : 1 }}
          disabled={picked.length === 0 || creating}
          onClick={sendInvites}
        >
          {creating
            ? 'Notifying…'
            : picked.length === 0
              ? 'Add someone above'
              : `Notify ${picked.length} ${picked.length === 1 ? 'friend' : 'friends'}`}
        </button>
      </div>

      {/* ── PEOPLE PANEL ───────────────────────────────────────────────────── */}
      {panelOpen && (
        <>
          <div onClick={closePanel} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 40, backdropFilter: 'blur(2px)',
          }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(420px, 100vw)',
            background: '#fff',
            borderRadius: '20px 0 0 20px',
            zIndex: 50,
            display: 'flex', flexDirection: 'column',
            boxShadow: '-8px 0 48px rgba(0,0,0,0.14)',
          }}>
            <div style={{
              padding: '28px 28px 20px',
              borderBottom: '1px solid #f0f0f0',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Add People</h3>
                <button onClick={closePanel} style={{
                  border: 'none', background: '#f5f5f5', borderRadius: '50%',
                  width: 36, height: 36, cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#666', fontWeight: 700,
                }}>✕</button>
              </div>
              <p style={{ fontSize: 13, color: '#aaa' }}>Top friends from bunq, or add someone new</p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

              <p style={{ ...s.label, marginBottom: 14 }}>TOP FRIENDS</p>

              {friendsLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, color: '#aaa', fontSize: 13 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: '2px solid #e0e0e0', borderTopColor: TEAL,
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Loading from bunq…
                </div>
              )}

              {friendsError && !friendsLoading && (
                <div style={{
                  background: '#fffbeb', border: '1px solid #fde68a',
                  borderRadius: 12, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e',
                }}>
                  ⚠ Couldn't reach bunq server — add manually below.
                </div>
              )}

              {!friendsLoading && topFriends.length === 0 && !friendsError && (
                <p style={{ fontSize: 13, color: '#bbb', marginBottom: 16 }}>
                  No transaction history yet. Run <code>seed_demo_friends.py</code>.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {topFriends.map((friend) => {
                  const selected = picked.some((p) => p.email === friend.email);
                  return (
                    <div
                      key={friend.id}
                      onClick={() => toggleFriend(friend)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '13px 16px', borderRadius: 16, cursor: 'pointer',
                        background: selected ? '#edfff8' : '#fafafa',
                        border: `1.5px solid ${selected ? TEAL : '#f0f0f0'}`,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{
                        width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                        background: friend.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 800, color: '#000',
                        boxShadow: selected ? `0 0 0 3px ${TEAL}55` : 'none',
                      }}>
                        {initials(friend.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{friend.name}</p>
                        <p style={{ fontSize: 12, color: '#b0b0b0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {friend.pointer_value}
                        </p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <span style={{
                          fontSize: 11, color: '#c0c0c0', background: '#f5f5f5',
                          borderRadius: 20, padding: '2px 8px', fontWeight: 600,
                        }}>
                          {friend.transaction_count}×
                        </span>
                        {selected && (
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', background: TEAL,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
                          }}>✓</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ ...s.divider, margin: '20px 0' }} />

              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    width: '100%', padding: '14px 16px',
                    border: '1.5px dashed #d4d4d4',
                    borderRadius: 16, background: 'transparent', cursor: 'pointer',
                    fontSize: 14, fontWeight: 600, color: '#888',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', background: '#f5f5f5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, lineHeight: 1, color: '#888',
                  }}>+</span>
                  Add someone new
                </button>
              ) : (
                <div style={{ background: '#fafafa', borderRadius: 16, padding: 18, border: '1.5px solid #e8e8e8' }}>
                  <p style={{ ...s.label, marginBottom: 14 }}>NEW PERSON</p>
                  <input
                    style={{ ...s.input, display: 'block', width: '100%', marginBottom: 10 }}
                    placeholder="Name"
                    value={newName}
                    autoFocus
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <input
                    style={{ ...s.input, display: 'block', width: '100%', marginBottom: 16 }}
                    placeholder="Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setShowAddForm(false); setNewName(''); setNewEmail(''); }}
                      style={{ ...s.btn, flex: 1, background: '#eeeeee', color: '#555', fontSize: 14 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addCustom}
                      disabled={!newName.trim() || !newEmail.trim()}
                      style={{ ...s.btn, flex: 2, fontSize: 14, opacity: (!newName.trim() || !newEmail.trim()) ? 0.4 : 1 }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {picked.length > 0 && (
              <div style={{
                padding: '16px 28px 28px', flexShrink: 0,
                borderTop: '1px solid #f0f0f0', background: '#fff',
              }}>
                <button onClick={closePanel} style={{ ...s.btn, borderRadius: 14 }}>
                  Done — {picked.length} {picked.length === 1 ? 'person' : 'people'} added ✓
                </button>
              </div>
            )}
          </div>
          <style>{`
            @keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
          `}</style>
        </>
      )}
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
          const stagedColor = picked.find((p) => p.name === inv.name)?.color;
          const isExpanded = expanded === inv.id;
          return (
            <div key={inv.id} style={{
              padding: '12px 14px', marginBottom: 8,
              background: '#fff', border: '1px solid #eee', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: stagedColor || TEAL,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: '#000',
                  flexShrink: 0,
                }}>
                  {initials(inv.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{inv.name}</p>
                  <p style={{ fontSize: 11, color: '#999' }}>
                    {state === 'pending' && '⏳ Waiting…'}
                    {state === 'paid' && 'Paid · just now'}
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
  chip: {
    background: '#f0f0f0',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'default',
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
