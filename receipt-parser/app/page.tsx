'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Receipt } from '@/lib/types/receipt';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:        '#0A0A0A',
  surface:   '#141414',
  surface2:  '#1C1C1C',
  surface3:  '#252525',
  border:    'rgba(255,255,255,0.06)',
  borderMd:  'rgba(255,255,255,0.10)',
  orange:    '#FF6B00',
  orangeDim: 'rgba(255,107,0,0.12)',
  green:     '#00E5A0',
  greenDim:  'rgba(0,229,160,0.10)',
  text:      '#FFFFFF',
  text2:     'rgba(255,255,255,0.50)',
  text3:     'rgba(255,255,255,0.26)',
  amber:     '#FFB347',
  amberDim:  'rgba(255,179,71,0.12)',
} as const;

const BUNQ_API = process.env.NEXT_PUBLIC_BUNQ_API_URL ?? 'http://localhost:8000';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Invitee      { id: string; name: string; alias: string }
interface InviteeStatus {
  id: string; name: string;
  status: 'pending' | 'paid' | 'skipped';
  claims: { itemId: number; sharedWith: number }[];
  amountPaid?: number;
}
interface TopFriend { name: string; pointer_type: string; pointer_value: string; transaction_count: number }
type Screen = 'capture' | 'people' | 'tracking' | 'done';

// ── Helpers ───────────────────────────────────────────────────────────────────
const initials = (n: string) => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n);

// ── Shared styles ─────────────────────────────────────────────────────────────
const bigBtn: React.CSSProperties = {
  display: 'block', width: '100%',
  padding: '19px 24px', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
  background: C.orange, color: '#000',
  border: 'none', borderRadius: 16, cursor: 'pointer', textAlign: 'center',
};

const ghostBtn: React.CSSProperties = {
  display: 'block', width: '100%',
  padding: '16px 24px', fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
  background: 'transparent', color: C.text3,
  border: `1px solid ${C.border}`, borderRadius: 12, cursor: 'pointer', textAlign: 'center',
};

const inputStyle: React.CSSProperties = {
  width: '100%', display: 'block', padding: '15px 16px',
  background: C.surface2, color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 12,
  fontSize: 15, outline: 'none',
};

const secLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: C.text3, marginBottom: 14,
};

const spinStyle: React.CSSProperties = {
  width: 17, height: 17, borderRadius: 9999,
  border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#000',
  display: 'inline-block', flexShrink: 0,
};

const avatarStyle: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 9999, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 13, fontWeight: 800,
};

// ── Root ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [screen,    setScreen]    = useState<Screen>('capture');
  const [receipt,   setReceipt]   = useState<Receipt | null>(null);
  const [hostName,  setHostName]  = useState('');
  const [people,    setPeople]    = useState<{ name: string; alias: string }[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [invitees,  setInvitees]  = useState<Invitee[]>([]);
  const [statuses,  setStatuses]  = useState<InviteeStatus[]>([]);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [copiedId,  setCopiedId]  = useState<string | null>(null);
  const [creating,  setCreating]  = useState(false);

  const [panelOpen,      setPanelOpen]      = useState(false);
  const [topFriends,     setTopFriends]     = useState<TopFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError,   setFriendsError]   = useState(false);
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [newName,        setNewName]        = useState('');
  const [newAlias,       setNewAlias]       = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  // Polling
  useEffect(() => {
    if (screen !== 'tracking' || !sessionId) return;
    let dead = false;
    const tick = async () => {
      try {
        const res  = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (dead) return;
        setStatuses(data.invitees);
        if (data.invitees.length > 0 && data.invitees.every((i: InviteeStatus) => i.status !== 'pending'))
          setScreen('done');
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { dead = true; clearInterval(id); };
  }, [screen, sessionId]);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(null);
    const form = new FormData();
    form.append('image', file);
    try {
      const res  = await fetch('/api/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Parse failed');
      setReceipt(data); setScreen('people');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally { setLoading(false); }
  }, []);

  const openPanel = async () => {
    setPanelOpen(true); setFriendsLoading(true); setFriendsError(false);
    try {
      const res = await fetch(`${BUNQ_API}/api/contacts/top?n=5`);
      if (!res.ok) throw new Error();
      setTopFriends(await res.json());
    } catch { setFriendsError(true); }
    finally { setFriendsLoading(false); }
  };

  const closePanel = () => { setPanelOpen(false); setShowAddForm(false); setNewName(''); setNewAlias(''); };

  const toggleFriend = (f: TopFriend) => {
    const idx = people.findIndex(p => p.alias === f.pointer_value);
    if (idx >= 0) setPeople(p => p.filter((_, i) => i !== idx));
    else setPeople(p => [...p, { name: f.name, alias: f.pointer_value }]);
  };

  const addManual = () => {
    if (!newName.trim() || !newAlias.trim()) return;
    setPeople(p => [...p, { name: newName.trim(), alias: newAlias.trim() }]);
    setNewName(''); setNewAlias(''); setShowAddForm(false);
  };

  const removePerson = (idx: number) => setPeople(p => p.filter((_, i) => i !== idx));

  const sendLinks = async () => {
    if (!receipt || !people.length) return;
    setCreating(true); setError(null);
    try {
      const res  = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt, hostName: hostName.trim() || 'Your friend', hostAlias: '', invitees: people }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setSessionId(data.sessionId); setInvitees(data.invitees); setScreen('tracking');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send links');
    } finally { setCreating(false); }
  };

  const inviteUrl  = (id: string) => typeof window !== 'undefined' ? `${window.location.origin}/split/${sessionId}/${id}` : '';
  const copyLink   = async (id: string) => {
    try { await navigator.clipboard.writeText(inviteUrl(id)); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); }
    catch { /* ignore */ }
  };
  const reset = () => {
    setScreen('capture'); setReceipt(null); setHostName(''); setPeople([]);
    setSessionId(null); setInvitees([]); setStatuses([]); setExpanded(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CAPTURE
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === 'capture') return (
    <main className="app-screen" style={{ background: `linear-gradient(165deg, #131313 0%, ${C.bg} 55%)` }}>

      {/* Hero */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '80px 28px 36px' }}>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
          background: C.orangeDim, border: `1px solid rgba(255,107,0,0.22)`,
          borderRadius: 9999, padding: '5px 14px 5px 9px', marginBottom: 40,
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.orange }} />
          <span style={{ fontSize: 11, fontWeight: 900, color: C.orange, letterSpacing: '0.09em' }}>SNAPSPLIT</span>
        </div>

        <h1 style={{
          fontSize: 84, fontWeight: 900, letterSpacing: '-0.055em', lineHeight: 0.87,
          color: C.text, marginBottom: 32,
        }}>
          Snap<br/>Split
        </h1>

        <p style={{ fontSize: 17, color: C.text2, lineHeight: 1.7, maxWidth: 300 }}>
          Photograph a receipt. Friends pick what they ordered and pay you back automatically via bunq.
        </p>
      </div>

      {/* CTA */}
      <div style={{ padding: '0 28px 56px' }}>
        {error && <ErrorBanner msg={error} />}
        <button
          style={{ ...bigBtn, marginBottom: 18, opacity: loading ? 0.6 : 1, fontSize: 17 }}
          disabled={loading}
          onClick={() => fileRef.current?.click()}
        >
          {loading
            ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span className="spin" style={spinStyle} />Reading receipt…
              </span>
            : '📷  Scan Receipt'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <p style={{ fontSize: 12, color: C.text3, textAlign: 'center' }}>Powered by bunq · GPT-4o vision</p>
      </div>
    </main>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PEOPLE
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === 'people' && receipt) return (
    <main className="app-screen" style={{ background: C.bg }}>

      {/* Sticky header */}
      <div className="app-bar" style={{ padding: '18px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <p style={{ ...secLabel, marginBottom: 4 }}>Receipt</p>
            <h2 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', color: C.text, lineHeight: 1 }}>
              {receipt.merchant ?? 'Untitled'}
            </h2>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em', color: C.green, lineHeight: 1 }}>
              {fmt(receipt.total, receipt.currency)}
            </p>
            <p style={{ fontSize: 12, color: C.text3, marginTop: 3 }}>
              {receipt.date ?? `${receipt.items.length} items`}
            </p>
          </div>
        </div>
        {receipt.warning && (
          <p style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>⚠ Totals may not match — verify before sending.</p>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 140px' }}>

        {/* Items list */}
        <div style={{ marginBottom: 32 }}>
          {receipt.items.map((item, i) => (
            <div key={item.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
              padding: '14px 0',
              borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{ fontSize: 14, color: C.text2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.description}
                {item.quantity > 1 && <span style={{ color: C.text3 }}> ×{item.quantity}</span>}
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.text, flexShrink: 0 }}>
                {fmt(item.line_total, receipt.currency)}
              </span>
            </div>
          ))}
          {(receipt.tax > 0 || receipt.tip > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.text3 }}>Tax &amp; tip</span>
              <span style={{ fontSize: 13, color: C.text3 }}>{fmt((receipt.tax ?? 0) + (receipt.tip ?? 0), receipt.currency)}</span>
            </div>
          )}
        </div>

        {/* Host name */}
        <div style={{ marginBottom: 32 }}>
          <p style={secLabel}>Your Name</p>
          <input
            style={inputStyle}
            placeholder="So friends know who's asking"
            value={hostName}
            onChange={e => setHostName(e.target.value)}
          />
        </div>

        {/* People */}
        <div style={{ marginBottom: 28 }}>
          <p style={secLabel}>Splitting With</p>

          {people.map((p, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '13px 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ ...avatarStyle, background: C.orangeDim, color: C.orange }}>{initials(p.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{p.name}</p>
                <p style={{ fontSize: 12, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.alias}</p>
              </div>
              <button onClick={() => removePerson(idx)} style={{
                background: 'none', border: 'none', color: C.text3, fontSize: 22,
                lineHeight: 1, padding: '4px 8px', cursor: 'pointer',
              }}>×</button>
            </div>
          ))}

          <button onClick={openPanel} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            width: '100%', padding: '16px 0', marginTop: people.length ? 4 : 0,
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{
              ...avatarStyle,
              width: 40, height: 40,
              background: people.length ? C.surface3 : C.orangeDim,
              color: people.length ? C.text3 : C.orange,
              fontSize: 22, fontWeight: 400,
            }}>+</div>
            <span style={{ fontSize: 15, fontWeight: 700, color: people.length ? C.text2 : C.orange }}>
              {people.length ? 'Add more people' : 'Add people to split with'}
            </span>
          </button>
        </div>

        <p style={{ fontSize: 13, color: C.text3, lineHeight: 1.65 }}>
          Each person gets a private link — they pick their items and pay you instantly via bunq.
        </p>

        {error && <div style={{ marginTop: 20 }}><ErrorBanner msg={error} /></div>}
      </div>

      {/* Fixed footer */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(24px)',
        borderTop: `1px solid ${C.border}`,
        padding: '16px 24px 32px',
      }}>
        <button
          style={{ ...bigBtn, opacity: (!people.length || creating) ? 0.38 : 1 }}
          disabled={!people.length || creating}
          onClick={sendLinks}
        >
          {creating
            ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span className="spin" style={spinStyle} />Creating session…
              </span>
            : `Send Links to ${people.length || '?'} ${people.length === 1 ? 'person' : 'people'} →`}
        </button>
      </div>

      {/* ── People drawer ───────────────────────────────────────────────────── */}
      {panelOpen && (
        <>
          <div className="panel-overlay" onClick={closePanel} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(8px)', zIndex: 40,
          }} />
          <div className="panel-drawer" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(400px, 100vw)',
            background: C.surface, borderLeft: `1px solid ${C.borderMd}`,
            zIndex: 50, display: 'flex', flexDirection: 'column',
            boxShadow: '-32px 0 80px rgba(0,0,0,0.6)',
          }}>
            {/* Drawer header */}
            <div style={{ padding: '24px 24px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.03em', color: C.text, marginBottom: 3 }}>Add People</h3>
                  <p style={{ fontSize: 13, color: C.text3 }}>Recent friends or add manually</p>
                </div>
                <button onClick={closePanel} style={{
                  width: 34, height: 34, borderRadius: 9999,
                  border: `1px solid ${C.border}`, background: C.surface2,
                  color: C.text2, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>×</button>
              </div>
            </div>

            {/* Drawer body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              <p style={secLabel}>From bunq</p>

              {friendsLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text3, fontSize: 13, marginBottom: 20 }}>
                  <span className="spin" style={{ ...spinStyle, border: `2px solid ${C.surface3}`, borderTopColor: C.orange }} />
                  Loading contacts…
                </div>
              )}
              {friendsError && !friendsLoading && (
                <div style={{
                  background: C.amberDim, border: `1px solid rgba(255,179,71,0.25)`,
                  borderRadius: 10, padding: '10px 14px', marginBottom: 16,
                  fontSize: 13, color: C.amber,
                }}>
                  ⚠ Can't reach bunq API — add manually below.
                </div>
              )}
              {!friendsLoading && !friendsError && topFriends.length === 0 && (
                <p style={{ fontSize: 13, color: C.text3, marginBottom: 16 }}>No history found — add someone manually.</p>
              )}

              <div style={{ marginBottom: 4 }}>
                {topFriends.map(friend => {
                  const sel = people.some(p => p.alias === friend.pointer_value);
                  return (
                    <div key={friend.pointer_value} onClick={() => toggleFriend(friend)} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 0', cursor: 'pointer',
                      borderBottom: `1px solid ${C.border}`,
                      opacity: 1,
                    }}>
                      <div style={{
                        ...avatarStyle,
                        background: sel ? C.orange : C.surface3,
                        color: sel ? '#000' : C.text2,
                        transition: 'all 0.12s',
                        boxShadow: sel ? `0 0 0 3px rgba(255,107,0,0.25)` : 'none',
                      }}>{initials(friend.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{friend.name}</p>
                        <p style={{ fontSize: 12, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{friend.pointer_value}</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{ fontSize: 11, color: C.text3 }}>{friend.transaction_count}×</span>
                        {sel && (
                          <div style={{ width: 18, height: 18, borderRadius: 9999, background: C.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#000' }}>✓</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ height: 1, background: C.border, margin: '20px 0' }} />
              <p style={secLabel}>Add Manually</p>

              {!showAddForm ? (
                <button onClick={() => setShowAddForm(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%', background: 'none', border: 'none',
                  padding: '14px 0', cursor: 'pointer',
                  borderBottom: `1px dashed ${C.borderMd}`,
                }}>
                  <div style={{ ...avatarStyle, background: C.surface3, color: C.text3, fontSize: 22, fontWeight: 400 }}>+</div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.text2 }}>Add someone new</span>
                </button>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Name" value={newName} autoFocus
                    onChange={e => setNewName(e.target.value)} />
                  <input style={{ ...inputStyle, marginBottom: 16 }} placeholder="Email or phone" value={newAlias}
                    onChange={e => setNewAlias(e.target.value)} onKeyDown={e => e.key === 'Enter' && addManual()} />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => { setShowAddForm(false); setNewName(''); setNewAlias(''); }} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                    <button onClick={addManual} disabled={!newName.trim() || !newAlias.trim()}
                      style={{ ...bigBtn, flex: 2, fontSize: 14, opacity: (!newName.trim() || !newAlias.trim()) ? 0.38 : 1 }}>Add</button>
                  </div>
                </div>
              )}
            </div>

            {/* Drawer footer */}
            {people.length > 0 && (
              <div style={{ padding: '16px 24px 28px', borderTop: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
                <button onClick={closePanel} style={bigBtn}>
                  Done — {people.length} {people.length === 1 ? 'person' : 'people'} selected ✓
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TRACKING
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === 'tracking' && receipt && sessionId) {
    const doneCount  = statuses.filter(st => st.status !== 'pending').length;
    const totalCount = invitees.length;
    const allDone    = totalCount > 0 && doneCount === totalCount;

    return (
      <main className="app-screen" style={{ background: C.bg }}>

        {/* Sticky header */}
        <div className="app-bar" style={{ padding: '20px 24px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <p style={{ ...secLabel, marginBottom: 6 }}>{allDone ? 'All settled' : 'Waiting'}</p>
              <p style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.045em', lineHeight: 1, color: allDone ? C.green : C.text }}>
                {fmt(receipt.total, receipt.currency)}
              </p>
              <p style={{ fontSize: 13, color: C.text3, marginTop: 5 }}>{receipt.merchant ?? 'Receipt'}</p>
            </div>
            <div style={{ textAlign: 'right', paddingTop: 4 }}>
              <p style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.04em', color: C.text, lineHeight: 1 }}>
                {doneCount}
                <span style={{ color: C.text3, fontSize: 20, fontWeight: 500 }}>/{totalCount}</span>
              </p>
              <p style={{ fontSize: 11, color: C.text3, marginTop: 4, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>settled</p>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, background: C.surface3, borderRadius: 9999, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 9999,
              background: allDone ? C.green : `linear-gradient(90deg, ${C.orange}, #FF9500)`,
              width: totalCount > 0 ? `${(doneCount / totalCount) * 100}%` : '0%',
              transition: 'width 0.6s ease, background 0.4s',
              boxShadow: allDone ? `0 0 10px rgba(0,229,160,0.5)` : `0 0 10px rgba(255,107,0,0.5)`,
            }} />
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 40px' }}>

          {/* Demo hint */}
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '14px 0', borderBottom: `1px solid ${C.border}`, marginBottom: 4,
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <p style={{ fontSize: 13, color: C.text3, lineHeight: 1.6 }}>
              Demo: open each link in a new tab to act as that friend.
            </p>
          </div>

          {/* Invitee rows */}
          {invitees.map(inv => {
            const stat   = statuses.find(st => st.id === inv.id);
            const state  = stat?.status ?? 'pending';
            const isPaid = state === 'paid';
            const isExp  = expanded === inv.id;

            return (
              <div key={inv.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '16px 0' }}>
                  <div style={{
                    ...avatarStyle,
                    background: isPaid ? C.greenDim : state === 'skipped' ? C.surface2 : C.surface3,
                    color: isPaid ? C.green : C.text2,
                  }}>{initials(inv.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>{inv.name}</p>
                    <p style={{ fontSize: 12, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.alias}</p>
                  </div>
                  <StatusChip state={state} amount={stat?.amountPaid} currency={receipt.currency} />
                </div>

                {state === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
                    <button onClick={() => copyLink(inv.id)} style={{
                      flex: 1, padding: '10px 12px',
                      background: C.surface2, border: `1px solid ${C.border}`,
                      borderRadius: 10, fontSize: 12, fontWeight: 700, color: C.text2, cursor: 'pointer',
                    }}>
                      {copiedId === inv.id ? '✓ Copied' : '📋 Copy link'}
                    </button>
                    <a href={inviteUrl(inv.id)} target="_blank" rel="noopener noreferrer" style={{
                      flex: 1, padding: '10px 12px',
                      background: C.surface2, border: `1px solid ${C.border}`,
                      borderRadius: 10, fontSize: 12, fontWeight: 700, color: C.text2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}>
                      ↗ Open as {inv.name.split(' ')[0]}
                    </a>
                  </div>
                )}

                {isPaid && stat && (
                  <div style={{ paddingBottom: 14 }}>
                    <button onClick={() => setExpanded(isExp ? null : inv.id)} style={{
                      background: 'none', border: 'none',
                      fontSize: 12, fontWeight: 700, color: C.green,
                      cursor: 'pointer', padding: '0 0 10px', display: 'block',
                    }}>
                      {isExp ? '▾ Hide breakdown' : '▸ See breakdown'}
                    </button>
                    {isExp && (
                      <div>
                        {stat.claims.length === 0
                          ? <p style={{ fontSize: 13, color: C.text3 }}>No items selected.</p>
                          : stat.claims.map(cl => {
                              const item = receipt.items.find(i => i.id === cl.itemId);
                              if (!item) return null;
                              const cost = item.line_total / Math.max(1, cl.sharedWith);
                              return (
                                <div key={cl.itemId} style={{
                                  display: 'flex', justifyContent: 'space-between',
                                  padding: '7px 0', borderBottom: `1px solid ${C.border}`,
                                  fontSize: 13, color: C.text2,
                                }}>
                                  <span>
                                    {item.description}
                                    {cl.sharedWith > 1 && <span style={{ color: C.text3 }}> ÷{cl.sharedWith}</span>}
                                  </span>
                                  <span style={{ fontWeight: 800, color: C.text }}>{fmt(cost, receipt.currency)}</span>
                                </div>
                              );
                            })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ marginTop: 32 }}>
            <button onClick={reset} style={ghostBtn}>Start over</button>
          </div>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DONE
  // ─────────────────────────────────────────────────────────────────────────
  if (screen === 'done' && receipt) {
    const collected  = statuses.filter(st => st.status === 'paid').reduce((s, st) => s + (st.amountPaid ?? 0), 0);
    const paidCount  = statuses.filter(st => st.status === 'paid').length;

    return (
      <main className="app-screen" style={{
        background: `linear-gradient(170deg, #0A0E0C 0%, ${C.bg} 50%)`,
        alignItems: 'center', justifyContent: 'center',
        padding: '48px 28px',
      }}>

        {/* Check ring */}
        <div style={{
          width: 88, height: 88, borderRadius: '50%',
          border: `2px solid ${C.green}`,
          background: C.greenDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, marginBottom: 32,
          boxShadow: `0 0 40px rgba(0,229,160,0.15)`,
        }}>✓</div>

        <p style={{ fontSize: 13, color: C.text3, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>You collected</p>
        <p style={{ fontSize: 68, fontWeight: 900, letterSpacing: '-0.055em', lineHeight: 1, color: C.green, marginBottom: 12 }}>
          {fmt(collected, receipt.currency)}
        </p>
        <p style={{ fontSize: 15, color: C.text2, marginBottom: 48 }}>
          {receipt.merchant ?? 'Receipt'} · {paidCount} payment{paidCount !== 1 ? 's' : ''}
        </p>

        {/* Summary */}
        <div style={{ width: '100%', maxWidth: 380, marginBottom: 40 }}>
          {statuses.map(st => (
            <div key={st.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '14px 0', borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  ...avatarStyle,
                  background: st.status === 'paid' ? C.greenDim : C.surface2,
                  color: st.status === 'paid' ? C.green : C.text3,
                }}>{initials(st.name)}</div>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{st.name}</span>
              </div>
              <StatusChip state={st.status} amount={st.amountPaid} currency={receipt.currency} />
            </div>
          ))}
        </div>

        <button onClick={reset} style={{ ...bigBtn, maxWidth: 380 }}>Split Another Bill</button>
      </main>
    );
  }

  return null;
}

// ── StatusChip ────────────────────────────────────────────────────────────────
function StatusChip({ state, amount, currency }: {
  state: 'pending' | 'paid' | 'skipped';
  amount?: number;
  currency: string;
}) {
  const cfg = {
    pending: { bg: 'rgba(255,179,71,0.12)', color: '#FFB347', border: 'rgba(255,179,71,0.25)', label: 'Pending' },
    paid:    { bg: 'rgba(0,229,160,0.10)',  color: '#00E5A0', border: 'rgba(0,229,160,0.25)', label: amount != null ? fmt(amount, currency) : 'Paid' },
    skipped: { bg: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', border: 'rgba(255,255,255,0.08)', label: 'Skipped' },
  };
  const { bg, color, border, label } = cfg[state];
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
      padding: '5px 13px', borderRadius: 9999,
      background: bg, color, border: `1px solid ${border}`,
    }}>{label}</span>
  );
}

// ── ErrorBanner ───────────────────────────────────────────────────────────────
function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{
      background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 10, padding: '11px 14px', marginBottom: 14,
      fontSize: 13, color: '#FCA5A5',
    }}>{msg}</div>
  );
}
