'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Receipt } from '@/lib/types/receipt';

const TEAL = '#00E5A0';

interface Invitee {
  id: string;
  name: string;
  alias: string;
}

<<<<<<< Updated upstream
interface InviteeStatus {
  id: string;
=======
interface TopFriend {
  name: string;
  pointer_type: string;
  pointer_value: string;
  transaction_count: number;
}

type AssignmentMap = Record<number, string[]>;
type Screen = 'capture' | 'assign' | 'confirm' | 'done';

interface SendResult {
  personId: string;
>>>>>>> Stashed changes
  name: string;
  status: 'pending' | 'paid' | 'skipped';
  claims: { itemId: number; sharedWith: number }[];
  amountPaid?: number;
  paidAt?: number;
}

type Screen = 'capture' | 'people' | 'tracking' | 'done';

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

<<<<<<< Updated upstream
export default function Home() {
  const [screen, setScreen] = useState<Screen>('capture');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [hostName, setHostName] = useState('');
  const [people, setPeople] = useState<{ name: string; alias: string }[]>([]);
  const [newName, setNewName] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [statuses, setStatuses] = useState<InviteeStatus[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
=======
function personTotal(person: Person, assignments: AssignmentMap, receipt: Receipt): number {
  let food = 0;
  const subtotal = receipt.items.reduce((s, i) => s + i.line_total, 0);
  for (const item of receipt.items) {
    const assignees = assignments[item.id] ?? [];
    if (assignees.includes(person.id)) food += item.line_total / assignees.length;
  }
  const extras = subtotal > 0 ? (food / subtotal) * (receipt.tax + receipt.tip) : 0;
  return Math.round((food + extras) * 100) / 100;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('capture');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<AssignmentMap>({});
  const [equalSplit, setEqualSplit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);

  // People panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [topFriends, setTopFriends] = useState<TopFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAlias, setNewAlias] = useState('');

>>>>>>> Stashed changes
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll status while tracking
  useEffect(() => {
    if (screen !== 'tracking' || !sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
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
      const res = await fetch(`${BUNQ_API}/api/contacts/top?n=5`);
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
    setNewAlias('');
  };

  const toggleFriend = (friend: TopFriend) => {
    const existing = people.find(p => p.alias === friend.pointer_value);
    if (existing) {
      removePerson(existing.id);
    } else {
      setPeople(p => [...p, { id: crypto.randomUUID(), name: friend.name, alias: friend.pointer_value }]);
    }
  };

  const addManual = () => {
    if (!newName.trim() || !newAlias.trim()) return;
    setPeople(p => [...p, { name: newName.trim(), alias: newAlias.trim() }]);
    setNewName('');
    setNewAlias('');
    setShowAddForm(false);
  };

  const removePerson = (idx: number) => {
    setPeople(p => p.filter((_, i) => i !== idx));
  };

  const sendLinks = async () => {
    if (!receipt || people.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt,
          hostName: hostName.trim() || 'Your friend',
          hostAlias: '',
          invitees: people,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create session');
      setSessionId(data.sessionId);
      setInvitees(data.invitees);
      setScreen('tracking');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send links');
    } finally {
      setCreating(false);
    }
  };

  const inviteUrl = (inviteeId: string) => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/split/${sessionId}/${inviteeId}`;
  };

  const copyLink = async (inviteeId: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(inviteeId));
      setCopiedId(inviteeId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {/* ignore */}
  };

  const reset = () => {
    setScreen('capture');
    setReceipt(null);
    setHostName('');
    setPeople([]);
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
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
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
          onChange={e => setHostName(e.target.value)}
        />

<<<<<<< Updated upstream
        <p style={s.label}>WHO'S SPLITTING WITH YOU</p>
        {people.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {people.map((p, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: '#f8faf8', borderRadius: 10, marginBottom: 6,
              }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</p>
                  <p style={{ fontSize: 12, color: '#999' }}>{p.alias}</p>
                </div>
                <button
                  onClick={() => removePerson(idx)}
                  style={{ background: 'transparent', border: 'none', color: '#999', cursor: 'pointer', fontSize: 16 }}
                >✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input style={s.input} placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
          <input
            style={s.input}
            placeholder="Email or phone"
            value={newAlias}
            onChange={e => setNewAlias(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPerson()}
          />
          <button onClick={addPerson} style={{ ...s.btn, width: 'auto', padding: '0 16px', fontSize: 20 }}>+</button>
        </div>

        <div style={{ background: '#f8faf8', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
          <p style={{ fontSize: 12, color: '#666', lineHeight: 1.4 }}>
            Each person gets a unique link. They'll pick their items and pay you with bunq.
          </p>
        </div>

        {error && <p style={s.error}>{error}</p>}
=======
        {/* People */}
        <p style={s.label}>WHO'S AT THE TABLE</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {people.map(p => (
            <div key={p.id} style={{ ...s.chip, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', background: TEAL,
                fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {initials(p.name)}
              </span>
              {p.name}
              <span onClick={() => removePerson(p.id)} style={{ cursor: 'pointer', color: '#999', fontSize: 12 }}>✕</span>
            </div>
          ))}
          <button onClick={openPanel} style={{
            ...s.chip, background: TEAL, color: '#000', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add People
          </button>
        </div>

        <div style={s.divider} />

        {/* Items */}
        {!equalSplit && (
          <>
            <p style={{ ...s.label, marginTop: 8 }}>ASSIGN ITEMS</p>
            {receipt.items.map(item => {
              const assignees = assignments[item.id] ?? [];
              return (
                <div key={item.id} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {item.description}
                      {item.quantity > 1 && <span style={{ color: '#999', fontWeight: 400 }}> ×{item.quantity}</span>}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{formatAmount(item.line_total, receipt.currency)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {people.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>Add people above to assign</span>}
                    {people.map(p => {
                      const on = assignees.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => toggleAssign(item.id, p.id)} style={{
                          ...s.chip, background: on ? TEAL : '#f0f0f0',
                          color: on ? '#000' : '#555', border: 'none', cursor: 'pointer', fontSize: 13,
                        }}>
                          {p.name}
                          {on && assignees.length > 1 && <span style={{ opacity: 0.6, fontSize: 11 }}> ÷{assignees.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Per-person totals */}
        {people.length > 0 && (
          <div style={{ background: '#f8faf8', borderRadius: 12, padding: '12px 16px', marginBottom: 20 }}>
            {people.map(p => {
              const amount = equalSplit ? receipt.total / people.length : personTotal(p, assignments, receipt);
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span>{p.name}</span>
                  <span style={{ fontWeight: 700 }}>{formatAmount(amount, receipt.currency)}</span>
                </div>
              );
            })}
            {receipt.tax > 0 && (
              <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>Tax & tip distributed proportionally</p>
            )}
          </div>
        )}
>>>>>>> Stashed changes

        <button
          style={{ ...s.btn, opacity: people.length === 0 || creating ? 0.4 : 1 }}
          disabled={people.length === 0 || creating}
          onClick={sendLinks}
        >
          {creating ? 'Creating links…' : `Send Links (${people.length})`}
        </button>
      </div>

      {/* ── PEOPLE PANEL ───────────────────────────────────────────────────── */}
      {panelOpen && (
        <>
          {/* Overlay */}
          <div
            className="panel-overlay"
            onClick={closePanel}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 40, backdropFilter: 'blur(2px)' }}
          />

          {/* Right-side drawer */}
          <div
            className="panel-drawer"
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(400px, 100vw)',
              background: '#fff',
              borderRadius: '20px 0 0 20px',
              zIndex: 50,
              display: 'flex', flexDirection: 'column',
              boxShadow: '-8px 0 48px rgba(0,0,0,0.14)',
            }}
          >
            {/* Panel header */}
            <div style={{
              padding: '28px 28px 0',
              borderBottom: '1px solid #f0f0f0',
              paddingBottom: 20,
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
              <p style={{ fontSize: 13, color: '#aaa' }}>Select from recent contacts or add manually</p>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

              {/* Top friends section */}
              <p style={{ ...s.label, marginBottom: 14 }}>RECENT CONTACTS</p>

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
                <p style={{ fontSize: 13, color: '#bbb', marginBottom: 16 }}>No transaction history found.</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {topFriends.map(friend => {
                  const selected = people.some(p => p.alias === friend.pointer_value);
                  return (
                    <div
                      key={friend.pointer_value}
                      onClick={() => toggleFriend(friend)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '13px 16px', borderRadius: 16, cursor: 'pointer',
                        background: selected ? '#edfff8' : '#fafafa',
                        border: `1.5px solid ${selected ? TEAL : '#f0f0f0'}`,
                        transition: 'all 0.15s',
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                        background: selected ? TEAL : '#ececec',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 800,
                        transition: 'background 0.15s',
                        boxShadow: selected ? `0 0 0 3px ${TEAL}33` : 'none',
                      }}>
                        {initials(friend.name)}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{friend.name}</p>
                        <p style={{ fontSize: 12, color: '#b0b0b0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {friend.pointer_value}
                        </p>
                      </div>

                      {/* Right side: tx count + checkmark */}
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

              {/* Add someone manually */}
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    width: '100%', padding: '14px 16px',
                    border: '1.5px dashed #d4d4d4',
                    borderRadius: 16, background: 'transparent', cursor: 'pointer',
                    fontSize: 14, fontWeight: 600, color: '#888',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'all 0.15s',
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
                <div style={{
                  background: '#fafafa', borderRadius: 16, padding: 18,
                  border: '1.5px solid #e8e8e8',
                }}>
                  <p style={{ ...s.label, marginBottom: 14 }}>NEW PERSON</p>
                  <input
                    style={{ ...s.input, display: 'block', width: '100%', marginBottom: 10 }}
                    placeholder="Name"
                    value={newName}
                    autoFocus
                    onChange={e => setNewName(e.target.value)}
                  />
                  <input
                    style={{ ...s.input, display: 'block', width: '100%', marginBottom: 16 }}
                    placeholder="Email or phone"
                    value={newAlias}
                    onChange={e => setNewAlias(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addManual()}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setShowAddForm(false); setNewName(''); setNewAlias(''); }}
                      style={{ ...s.btn, flex: 1, background: '#eeeeee', color: '#555', fontSize: 14 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addManual}
                      disabled={!newName.trim() || !newAlias.trim()}
                      style={{ ...s.btn, flex: 2, fontSize: 14, opacity: (!newName.trim() || !newAlias.trim()) ? 0.4 : 1 }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky footer */}
            {people.length > 0 && (
              <div style={{
                padding: '16px 28px 28px', flexShrink: 0,
                borderTop: '1px solid #f0f0f0', background: '#fff',
              }}>
                <button onClick={closePanel} style={{ ...s.btn, borderRadius: 14 }}>
                  Done — {people.length} {people.length === 1 ? 'person' : 'people'} added ✓
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );

  // ── TRACKING ──────────────────────────────────────────────────────────────

  if (screen === 'tracking' && receipt && sessionId) return (
    <main style={{ ...s.page, alignItems: 'flex-start', paddingTop: 24 }}>
      <div style={{ ...s.card, maxWidth: 540, textAlign: 'left' }}>

<<<<<<< Updated upstream
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Waiting for friends</h2>
          <span style={{ fontSize: 12, color: '#888' }}>
            {statuses.filter(s => s.status !== 'pending').length}/{statuses.length} done
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          {receipt.merchant ?? 'Receipt'} · {formatAmount(receipt.total, receipt.currency)}
        </p>

        <div style={{
          background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#8a6d00',
        }}>
          💡 Demo mode: open each link in a new tab to act as that friend.
        </div>

        {invitees.map(inv => {
          const status = statuses.find(s => s.id === inv.id);
          const state = status?.status ?? 'pending';
          const url = inviteUrl(inv.id);
          const isExpanded = expanded === inv.id;
          return (
            <div key={inv.id} style={{
              padding: '12px 14px', marginBottom: 8,
              background: '#fff', border: '1px solid #eee', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{inv.name}</p>
                  <p style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.alias}
                  </p>
                </div>
                <StatusChip state={state} amount={status?.amountPaid} currency={receipt.currency} />
=======
        {people.map(p => {
          const amount = equalSplit ? receipt.total / people.length : personTotal(p, assignments, receipt);
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%', background: TEAL,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, marginRight: 12, flexShrink: 0,
              }}>
                {initials(p.name)}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</p>
                <p style={{ fontSize: 12, color: '#aaa' }}>{p.alias}</p>
>>>>>>> Stashed changes
              </div>

              {state === 'pending' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button
                    onClick={() => copyLink(inv.id)}
                    style={s.smallBtn}
                  >
                    {copiedId === inv.id ? '✓ Copied' : '📋 Copy link'}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...s.smallBtn, textDecoration: 'none', textAlign: 'center', display: 'inline-block' }}
                  >
                    ↗ Open as {inv.name.split(' ')[0]}
                  </a>
                </div>
              )}

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
                    <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
                      {status.claims.length === 0 ? (
                        <p style={{ color: '#999' }}>No items</p>
                      ) : (
                        status.claims.map(c => {
                          const item = receipt.items.find(i => i.id === c.itemId);
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
      .filter(s => s.status === 'paid')
      .reduce((sum, s) => sum + (s.amountPaid ?? 0), 0);
    return (
      <main style={s.page}>
        <div style={{ ...s.card, maxWidth: 480 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h2 style={{ ...s.title, fontSize: 24 }}>All done!</h2>
          <p style={s.sub}>
            Collected {formatAmount(collected, receipt.currency)} of {formatAmount(receipt.total, receipt.currency)}
          </p>

<<<<<<< Updated upstream
          <div style={{ textAlign: 'left', marginTop: 16 }}>
            {statuses.map(s => (
              <div key={s.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid #f0f0f0',
              }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
                <StatusChip state={s.status} amount={s.amountPaid} currency={receipt.currency} />
              </div>
            ))}
=======
        {results.map(r => (
          <div key={r.personId} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', background: r.status === 'success' ? TEAL : '#fee2e2',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, marginRight: 12, flexShrink: 0,
            }}>
              {initials(r.name)}
            </div>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{r.name}</span>
            <span style={{ fontSize: 14, marginRight: 10 }}>{receipt && formatAmount(r.amount, receipt.currency)}</span>
            <span>{r.status === 'success' ? '✅' : '❌'}</span>
>>>>>>> Stashed changes
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
  smallBtn: {
    flex: 1,
    padding: '8px 10px',
    background: '#f0f0f0', color: '#333',
    border: 'none', borderRadius: 8,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
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
