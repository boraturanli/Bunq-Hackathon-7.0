'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Receipt } from '@/lib/types/receipt';
import { TOK, FONT_DISPLAY, FONT_MONO } from '@/lib/design/tokens';
import { ICN } from '@/lib/design/icons';
import { Avatar, Money } from '@/lib/design/primitives';

// ─── types ──────────────────────────────────────────────────────────────────

interface TopFriend {
  id: string; name: string; email: string; color: string;
  iban: string | null; pointer_type: string; pointer_value: string;
  transaction_count: number;
}
interface PickedPerson {
  name: string; email: string; color: string; source: 'top-friend' | 'custom';
}
interface CreatedInvitee { id: string; userId: string; name: string }
interface InviteeStatus {
  id: string; name: string;
  status: 'pending' | 'paid' | 'skipped';
  claims: { itemId: number; sharedWith: number }[];
  amountPaid?: number; paidAt?: number;
}

type Screen = 'capture' | 'people' | 'tracking' | 'done';

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── page ──────────────────────────────────────────────────────────────────

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

  const [panelOpen, setPanelOpen] = useState(false);
  const [topFriends, setTopFriends] = useState<TopFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

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
  const closePanel = () => { setPanelOpen(false); setShowAddForm(false); setNewName(''); setNewEmail(''); };
  const toggleFriend = (f: TopFriend) => {
    setPicked((prev) => {
      if (prev.find((p) => p.email === f.email)) return prev.filter((p) => p.email !== f.email);
      return [...prev, { name: f.name, email: f.email, color: f.color, source: 'top-friend' }];
    });
  };
  const addCustom = () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setPicked((prev) => {
      if (prev.find((p) => p.email === newEmail.trim())) return prev;
      return [...prev, { name: newName.trim(), email: newEmail.trim(), color: '', source: 'custom' }];
    });
    setNewName(''); setNewEmail(''); setShowAddForm(false);
  };
  const removePicked = (email: string) => setPicked((prev) => prev.filter((p) => p.email !== email));

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
            name: p.name, email: p.email,
            color: p.color || undefined, source: p.source,
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
    setScreen('capture'); setReceipt(null); setHostName('');
    setPicked([]); setSessionId(null); setInvitees([]);
    setStatuses([]); setExpanded(null);
  };

  // ─── CAPTURE ─────────────────────────────────────────────────────────────

  if (screen === 'capture') return (
    <main style={{ ...page, position: 'relative', overflow: 'hidden' }}>
      {/* Atmospheric blobs */}
      <div style={{ position: 'absolute', top: -100, left: -80,  width: 280, height: 280, borderRadius: '50%', background: TOK.accent, opacity: 0.18, filter: 'blur(80px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 200,  right: -100, width: 240, height: 240, borderRadius: '50%', background: TOK.plum,   opacity: 0.25, filter: 'blur(80px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: 160, left: -60, width: 220, height: 220, borderRadius: '50%', background: TOK.rose,   opacity: 0.18, filter: 'blur(80px)', pointerEvents: 'none' }} />

      <div style={{ maxWidth: 440, margin: '0 auto', padding: 20, position: 'relative' }}>
        {/* Top bar */}
        <div style={{ paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: TOK.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 14, color: TOK.accentInk,
            }}>S</div>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>SnapSplit</span>
          </div>
          <a href="/inbox" style={{
            padding: '6px 12px', borderRadius: 999,
            background: TOK.surface, border: `1px solid ${TOK.border}`,
            color: TOK.text, fontSize: 11, fontWeight: 700,
          }}>Demo lobby →</a>
        </div>

        {/* Hero */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 999,
          background: `${TOK.accent}18`, border: `1px solid ${TOK.accent}55`,
          marginBottom: 18,
        }}>
          <div style={{ color: TOK.accent }}>{ICN.sparkle(TOK.accent)}</div>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: TOK.accent, letterSpacing: '0.06em', fontFamily: FONT_MONO }}>
            AI · LIVE
          </span>
        </div>
        <h1 style={{
          fontFamily: FONT_DISPLAY, fontSize: 52, fontWeight: 700,
          letterSpacing: '-0.045em', lineHeight: 0.92,
        }}>
          Snap the<br />receipt.<br />
          <span style={{ color: TOK.accent, fontStyle: 'italic' }}>They</span> pay<br />you back.
        </h1>
        <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 16, lineHeight: 1.5, maxWidth: 360 }}>
          AI reads your bill in seconds. Friends tap what they had — money lands in your account.
        </p>

        {error && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: `${TOK.scarlet}20`, border: `1px solid ${TOK.scarlet}55`, borderRadius: 12, color: TOK.scarlet, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Big CTA */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          style={{
            width: '100%', marginTop: 24, padding: '18px 20px',
            background: TOK.accent, border: 'none', borderRadius: 18,
            color: TOK.accentInk, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', opacity: loading ? 0.6 : 1,
            boxShadow: `0 16px 40px ${TOK.accent}40`,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TOK.accentInk} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h-4l-2 2H4a1 1 0 00-1 1v12a1 1 0 001 1h16a1 1 0 001-1V7a1 1 0 00-1-1h-4z" /><circle cx="12" cy="13" r="4" />
            </svg>
            {loading ? 'Reading receipt…' : 'Scan a receipt'}
          </span>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: TOK.accentInk, color: TOK.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{ICN.arrow(TOK.accent)}</div>
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          style={{
            width: '100%', marginTop: 10, padding: '14px 20px',
            background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 18,
            color: TOK.text, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Upload an image instead
        </button>
        <input
          ref={fileRef}
          type="file" accept="image/*" capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {/* Live feed strip */}
        <div style={{ marginTop: 28 }}>
          <div style={{
            background: TOK.surface, border: `1px solid ${TOK.border}`,
            borderRadius: 22, padding: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: TOK.textDim, fontFamily: FONT_MONO }}>RECENT · 2 ACTIVE</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: TOK.mint, fontFamily: FONT_MONO }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: TOK.mint }} />
                LIVE
              </span>
            </div>
            {[
              { name: 'Bistro Lumière', sub: '3 friends · 1 paid', total: '€82.40', color: TOK.plum, paid: 33 },
              { name: 'Sushi Kaito',    sub: 'Settled · 4/4',     total: '€58.00', color: TOK.teal, paid: 100 },
            ].map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderTop: i ? `1px solid ${TOK.border}` : 'none',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `${r.color}30`, border: `1px solid ${r.color}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{ICN.receipt(r.color)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</p>
                  <p style={{ fontSize: 11, color: TOK.textDim }}>{r.sub}</p>
                  <div style={{ marginTop: 6, height: 3, background: TOK.surface2, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${r.paid}%`, height: '100%', background: r.paid === 100 ? TOK.mint : TOK.accent }} />
                  </div>
                </div>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700 }}>{r.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );

  // ─── PEOPLE ──────────────────────────────────────────────────────────────

  if (screen === 'people' && receipt) return (
    <main style={{ ...page, paddingBottom: 40 }}>
      <div style={{ maxWidth: 540, margin: '0 auto', padding: 20 }}>

        {/* Top bar */}
        <div style={{ paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={reset} style={iconBtn}>{ICN.chevL()}</button>
          <span style={{ fontSize: 11, fontWeight: 800, color: TOK.accent, letterSpacing: '0.08em', fontFamily: FONT_MONO, display: 'flex', alignItems: 'center', gap: 5 }}>
            {ICN.sparkle(TOK.accent)} PARSED IN 2.3s
          </span>
          <button style={iconBtn}>···</button>
        </div>

        {/* Receipt header */}
        <p style={{ fontSize: 12, color: TOK.textDim, fontFamily: FONT_MONO, letterSpacing: '0.06em' }}>
          {(receipt.merchant ?? 'RECEIPT').toUpperCase()} · {receipt.date ?? new Date().toLocaleDateString()}
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 4 }}>
          {(() => { const [w, c] = splitMoney(receipt.total); return <Money whole={w} cents={c} size={48} currency={receipt.currency === 'EUR' ? '€' : receipt.currency === 'USD' ? '$' : '£'} />; })()}
        </div>
        <p style={{ fontSize: 12, color: TOK.textDim, marginTop: 6 }}>
          {receipt.items.length} items
          {receipt.warning && <span style={{ color: TOK.amber }}> · totals don't match</span>}
        </p>

        {/* Your name */}
        <div style={{ marginTop: 24 }}>
          <p style={mono10}>YOUR NAME</p>
          <input
            style={input}
            placeholder="So they know who's asking"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
          />
        </div>

        {/* Picked people */}
        <div style={{ marginTop: 24 }}>
          <p style={mono10}>WHO&apos;S AT THE TABLE</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {picked.map((p) => (
              <div key={p.email} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px 5px 5px', borderRadius: 999,
                background: TOK.surface, border: `1px solid ${TOK.border}`,
              }}>
                <Avatar name={p.name} color={p.color || hashColor(p.email)} size={24} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: TOK.text }}>{p.name}</span>
                <button onClick={() => removePicked(p.email)} style={{
                  background: 'transparent', border: 'none', color: TOK.textFaint,
                  fontSize: 13, cursor: 'pointer', paddingLeft: 4,
                }}>✕</button>
              </div>
            ))}
            <button onClick={openPanel} style={{
              padding: '5px 14px', borderRadius: 999,
              background: TOK.accent, border: 'none', color: TOK.accentInk,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add People
            </button>
          </div>
        </div>

        {/* Hint */}
        <div style={{
          marginTop: 24, padding: '12px 14px', borderRadius: 14,
          background: `${TOK.accent}10`, border: `1px solid ${TOK.accent}30`,
          fontSize: 12, color: TOK.textDim,
        }}>
          They&apos;ll get a notification in their bunq inbox — open the <a href="/inbox" target="_blank" rel="noopener noreferrer" style={{ color: TOK.accent, fontWeight: 700 }}>demo lobby</a> to pre-stage tabs.
        </div>

        {error && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: `${TOK.scarlet}20`, border: `1px solid ${TOK.scarlet}55`, borderRadius: 12, color: TOK.scarlet, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Send CTA */}
        <button
          onClick={sendInvites}
          disabled={picked.length === 0 || creating}
          style={{
            width: '100%', marginTop: 24, padding: '16px',
            background: picked.length === 0 ? TOK.surface : TOK.accent,
            color: picked.length === 0 ? TOK.textDim : TOK.accentInk,
            border: picked.length === 0 ? `1px solid ${TOK.border}` : 'none',
            borderRadius: 16, fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: picked.length === 0 ? 'default' : 'pointer',
            boxShadow: picked.length > 0 ? `0 12px 32px ${TOK.accent}30` : 'none',
            opacity: creating ? 0.6 : 1,
          }}
        >
          {creating
            ? 'Notifying…'
            : picked.length === 0
              ? 'Add someone above'
              : <>Send links to {picked.length} {picked.length === 1 ? 'friend' : 'friends'} {ICN.arrow(picked.length === 0 ? TOK.textDim : TOK.accentInk)}</>}
        </button>
      </div>

      {/* People panel */}
      {panelOpen && (
        <>
          <div className="panel-overlay" onClick={closePanel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, backdropFilter: 'blur(2px)' }} />
          <div className="panel-drawer" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(440px, 100vw)',
            background: TOK.surface,
            borderRadius: '20px 0 0 20px',
            zIndex: 50,
            display: 'flex', flexDirection: 'column',
            boxShadow: '-8px 0 48px rgba(0,0,0,0.6)',
            color: TOK.text,
            border: `1px solid ${TOK.border}`,
            borderRight: 'none',
          }}>
            <div style={{ padding: '28px 24px 18px', borderBottom: `1px solid ${TOK.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Add People</h3>
                <button onClick={closePanel} style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: TOK.surface2, border: `1px solid ${TOK.border}`,
                  color: TOK.text, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              </div>
              <p style={{ fontSize: 12, color: TOK.textDim, marginTop: 4 }}>Top friends from bunq, or add someone new</p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              <p style={mono10}>TOP FRIENDS</p>

              {friendsLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: TOK.textDim, fontSize: 13, marginBottom: 16 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${TOK.border}`, borderTopColor: TOK.accent, animation: 'spin 0.8s linear infinite' }} />
                  Loading from bunq…
                </div>
              )}
              {friendsError && !friendsLoading && (
                <div style={{ background: `${TOK.amber}15`, border: `1px solid ${TOK.amber}40`, borderRadius: 12, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: TOK.amber }}>
                  ⚠ Couldn&apos;t reach bunq server — add manually below.
                </div>
              )}
              {!friendsLoading && topFriends.length === 0 && !friendsError && (
                <p style={{ fontSize: 12.5, color: TOK.textFaint, marginBottom: 16 }}>
                  No transaction history yet. Run <code style={{ background: TOK.surface2, padding: '1px 5px', borderRadius: 4 }}>seed_demo_friends.py</code>.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topFriends.map((f) => {
                  const selected = picked.some((p) => p.email === f.email);
                  return (
                    <div
                      key={f.id}
                      onClick={() => toggleFriend(f)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                        background: selected ? `${TOK.accent}15` : TOK.surface2,
                        border: `1.5px solid ${selected ? TOK.accent : TOK.border}`,
                      }}
                    >
                      <Avatar name={f.name} color={f.color} size={42} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 700, fontSize: 14 }}>{f.name}</p>
                        <p style={{ fontSize: 11, color: TOK.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.pointer_value}
                        </p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{
                          fontSize: 10, color: TOK.textFaint, background: TOK.surface,
                          borderRadius: 999, padding: '2px 8px', fontWeight: 700,
                          fontFamily: FONT_MONO,
                        }}>{f.transaction_count}×</span>
                        {selected && (
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', background: TOK.accent,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>{ICN.check(TOK.accentInk)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ height: 1, background: TOK.border, margin: '20px 0' }} />

              {!showAddForm ? (
                <button onClick={() => setShowAddForm(true)} style={{
                  width: '100%', padding: '14px 16px',
                  border: `1.5px dashed ${TOK.borderHi}`, borderRadius: 14,
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, color: TOK.textDim,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 18 }}>+</span> Add someone new
                </button>
              ) : (
                <div style={{ background: TOK.surface2, borderRadius: 14, padding: 16, border: `1px solid ${TOK.border}` }}>
                  <p style={mono10}>NEW PERSON</p>
                  <input style={{ ...input, marginBottom: 8 }} placeholder="Name" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} />
                  <input style={{ ...input, marginBottom: 12 }} placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setShowAddForm(false); setNewName(''); setNewEmail(''); }} style={{
                      flex: 1, padding: '10px', borderRadius: 10,
                      background: TOK.surface, border: `1px solid ${TOK.border}`,
                      color: TOK.textDim, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={addCustom} disabled={!newName.trim() || !newEmail.trim()} style={{
                      flex: 2, padding: '10px', borderRadius: 10,
                      background: TOK.accent, border: 'none', color: TOK.accentInk,
                      fontSize: 13, fontWeight: 800, cursor: 'pointer',
                      opacity: (!newName.trim() || !newEmail.trim()) ? 0.4 : 1,
                    }}>Add</button>
                  </div>
                </div>
              )}
            </div>

            {picked.length > 0 && (
              <div style={{ padding: '16px 24px 24px', borderTop: `1px solid ${TOK.border}`, background: TOK.surface, flexShrink: 0 }}>
                <button onClick={closePanel} style={{
                  width: '100%', padding: '14px',
                  background: TOK.accent, border: 'none', borderRadius: 14,
                  color: TOK.accentInk, fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700,
                  cursor: 'pointer',
                }}>
                  Done — {picked.length} {picked.length === 1 ? 'person' : 'people'} added ✓
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );

  // ─── TRACKING ────────────────────────────────────────────────────────────

  if (screen === 'tracking' && receipt && sessionId) {
    const collected = statuses.filter((s) => s.status === 'paid').reduce((a, s) => a + (s.amountPaid ?? 0), 0);
    const ringPct = receipt.total > 0 ? Math.min(1, collected / receipt.total) : 0;
    const C = 276;

    return (
      <main style={{ ...page, paddingBottom: 40 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
          <div style={{ paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <button onClick={reset} style={iconBtn}>{ICN.chevL()}</button>
            <span style={{ fontSize: 11, fontWeight: 800, color: TOK.textDim, letterSpacing: '0.08em', fontFamily: FONT_MONO }}>WAITING ROOM</span>
            <div style={{ width: 36 }} />
          </div>

          {/* Hero progress ring */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <div style={{ position: 'relative', width: 220, height: 220 }}>
              <svg width="220" height="220" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="50" cy="50" r="44" fill="none" stroke={TOK.surface2} strokeWidth="6" />
                <circle cx="50" cy="50" r="44" fill="none" stroke={TOK.accent} strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${ringPct * C} ${C}`}
                  style={{ transition: 'stroke-dasharray 0.6s ease' }} />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: TOK.textDim, fontFamily: FONT_MONO }}>COLLECTED</span>
                {(() => { const [w, c] = splitMoney(collected); return <Money whole={w} cents={c} size={36} />; })()}
                <span style={{ fontSize: 11, color: TOK.textFaint, marginTop: 2 }}>of {formatAmount(receipt.total, receipt.currency)}</span>
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {statuses.filter((s) => s.status !== 'pending').length} of {statuses.length} {statuses.filter((s) => s.status !== 'pending').length === 1 ? 'paid up' : 'paid up'}
            </h2>
            <p style={{ fontSize: 12.5, color: TOK.textDim, marginTop: 4 }}>
              {statuses.some((s) => s.status === 'pending') ? 'Live updates as friends review and pay' : 'Everyone\'s done!'}
            </p>
          </div>

          <div style={{ marginTop: 20 }}>
            {invitees.map((inv) => {
              const status = statuses.find((x) => x.id === inv.id);
              const state = status?.status ?? 'pending';
              const isExpanded = expanded === inv.id;
              return (
                <div key={inv.id} style={{
                  marginBottom: 8, padding: 14, borderRadius: 14,
                  background: state === 'paid' ? `${TOK.mint}10` : TOK.surface,
                  border: `1px solid ${state === 'paid' ? `${TOK.mint}40` : TOK.border}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar name={inv.name} color={hashColor(inv.name)} size={40} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 700 }}>{inv.name}</p>
                      <p style={{ fontSize: 11, color: TOK.textDim, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        {state === 'paid'  && <>{ICN.check(TOK.mint)} Paid · just now</>}
                        {state === 'pending' && <>{ICN.clock(TOK.amber)} Reviewing items…</>}
                        {state === 'skipped' && <>Had nothing</>}
                      </p>
                    </div>
                    {state === 'paid' && status?.amountPaid != null
                      ? (() => { const [w, c] = splitMoney(status.amountPaid); return <Money whole={w} cents={c} size={16} color={TOK.mint} />; })()
                      : state === 'pending'
                        ? <span style={{ fontSize: 11, color: TOK.amber, fontWeight: 700, fontFamily: FONT_MONO }}>PENDING</span>
                        : <span style={{ fontSize: 11, color: TOK.textFaint, fontWeight: 700, fontFamily: FONT_MONO }}>SKIPPED</span>}
                  </div>
                  {state === 'paid' && status && (
                    <>
                      <button onClick={() => setExpanded(isExpanded ? null : inv.id)} style={{
                        marginTop: 10, background: 'transparent', border: 'none',
                        color: TOK.accent, fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: 0,
                        fontFamily: FONT_MONO, letterSpacing: '0.04em',
                      }}>
                        {isExpanded ? '▾ HIDE BREAKDOWN' : '▸ SEE WHAT THEY PAID FOR'}
                      </button>
                      {isExpanded && (
                        <div style={{ marginTop: 8, fontSize: 12, color: TOK.textDim }}>
                          {status.claims.length === 0 ? (
                            <p style={{ color: TOK.textFaint }}>No items</p>
                          ) : status.claims.map((c) => {
                            const item = receipt.items.find((i) => i.id === c.itemId);
                            if (!item) return null;
                            const cost = item.line_total / Math.max(1, c.sharedWith);
                            return (
                              <div key={c.itemId} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                                <span>{item.description}{c.sharedWith > 1 && <span style={{ color: TOK.textFaint }}> ÷{c.sharedWith}</span>}</span>
                                <span style={{ fontFamily: FONT_MONO }}>{formatAmount(cost, receipt.currency)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={reset} style={{
            display: 'block', width: '100%', marginTop: 16, padding: '12px',
            background: 'transparent', color: TOK.textDim,
            border: `1px solid ${TOK.border}`, borderRadius: 12,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            Start over
          </button>
        </div>
      </main>
    );
  }

  // ─── DONE ────────────────────────────────────────────────────────────────

  if (screen === 'done' && receipt) {
    const collected = statuses.filter((x) => x.status === 'paid').reduce((s, x) => s + (x.amountPaid ?? 0), 0);
    return (
      <main style={page}>
        <div style={{ maxWidth: 440, margin: '0 auto', padding: 24, paddingTop: 60 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 64, marginBottom: 8 }}>🎉</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em' }}>All done!</h2>
            <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 8 }}>
              Collected {formatAmount(collected, receipt.currency)} of {formatAmount(receipt.total, receipt.currency)}
            </p>
          </div>

          <div>
            {statuses.map((x) => (
              <div key={x.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 14px', marginBottom: 8,
                background: TOK.surface, border: `1px solid ${TOK.border}`,
                borderRadius: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={x.name} color={hashColor(x.name)} size={32} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{x.name}</span>
                </div>
                {x.status === 'paid' && x.amountPaid != null
                  ? <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: TOK.mint }}>{formatAmount(x.amountPaid, receipt.currency)}</span>
                  : <span style={{ fontSize: 11, color: TOK.textFaint, fontWeight: 700, fontFamily: FONT_MONO }}>{x.status.toUpperCase()}</span>}
              </div>
            ))}
          </div>

          <button onClick={reset} style={{
            width: '100%', marginTop: 24, padding: '16px',
            background: TOK.accent, border: 'none', borderRadius: 14,
            color: TOK.accentInk, fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700,
            cursor: 'pointer',
          }}>
            Split another
          </button>
        </div>
      </main>
    );
  }

  return null;
}

// ─── shared styles ──────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: TOK.bg,
  color: TOK.text,
};

const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  background: TOK.surface, border: `1px solid ${TOK.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: TOK.text, cursor: 'pointer',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: TOK.surface,
  border: `1px solid ${TOK.border}`,
  borderRadius: 12,
  color: TOK.text,
  fontSize: 14,
  fontFamily: 'inherit',
};

const mono10: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  color: TOK.textDim, fontFamily: FONT_MONO, marginBottom: 10,
};
