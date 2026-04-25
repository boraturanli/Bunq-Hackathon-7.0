'use client';

import { useState, useRef, useCallback } from 'react';
import type { Receipt } from '@/lib/types/receipt';

interface Person {
  id: string;
  name: string;
  alias: string;
}

type AssignmentMap = Record<number, string[]>; // itemId → personIds
type Screen = 'capture' | 'assign' | 'confirm' | 'done';

interface SendResult {
  personId: string;
  name: string;
  amount: number;
  status: 'success' | 'error';
}

const BUNQ_API = process.env.NEXT_PUBLIC_BUNQ_API_URL ?? 'http://localhost:8000';
const TEAL = '#00E5A0';

function personTotal(person: Person, assignments: AssignmentMap, receipt: Receipt): number {
  let food = 0;
  const subtotal = receipt.items.reduce((s, i) => s + i.line_total, 0);
  for (const item of receipt.items) {
    const assignees = assignments[item.id] ?? [];
    if (assignees.includes(person.id)) {
      food += item.line_total / assignees.length;
    }
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
  const [newName, setNewName] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
      setAssignments({});
      setEqualSplit(false);
      setScreen('assign');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  const addPerson = () => {
    if (!newName.trim() || !newAlias.trim()) return;
    setPeople(p => [...p, { id: crypto.randomUUID(), name: newName.trim(), alias: newAlias.trim() }]);
    setNewName('');
    setNewAlias('');
  };

  const removePerson = (id: string) => {
    setPeople(p => p.filter(p => p.id !== id));
    setAssignments(prev => {
      const next = { ...prev };
      for (const key in next) next[+key] = next[+key].filter(pid => pid !== id);
      return next;
    });
  };

  const toggleAssign = (itemId: number, personId: string) => {
    setAssignments(prev => {
      const current = prev[itemId] ?? [];
      const next = current.includes(personId)
        ? current.filter(id => id !== personId)
        : [...current, personId];
      return { ...prev, [itemId]: next };
    });
  };

  const sendRequests = async () => {
    if (!receipt) return;
    setSending(true);
    const out: SendResult[] = [];
    for (const person of people) {
      const amount = equalSplit
        ? Math.round((receipt.total / people.length) * 100) / 100
        : personTotal(person, assignments, receipt);
      if (amount <= 0) continue;
      try {
        const res = await fetch(`${BUNQ_API}/api/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount.toFixed(2),
            description: `${receipt.merchant ?? 'Dinner'} · Smart Split`,
            recipient: person.alias,
            pointer_type: person.alias.includes('@') ? 'EMAIL' : 'PHONE_NUMBER',
          }),
        });
        out.push({ personId: person.id, name: person.name, amount, status: res.ok ? 'success' : 'error' });
      } catch {
        out.push({ personId: person.id, name: person.name, amount, status: 'error' });
      }
    }
    setResults(out);
    setSending(false);
    setScreen('done');
  };

  // ── CAPTURE ───────────────────────────────────────────────────────────────

  if (screen === 'capture') return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🧾</div>
        <h1 style={s.title}>Smart Split</h1>
        <p style={s.sub}>Photograph the receipt and split the bill instantly</p>
        {error && <p style={s.error}>{error}</p>}
        <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={() => fileRef.current?.click()}>
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

  // ── ASSIGN ────────────────────────────────────────────────────────────────

  if (screen === 'assign' && receipt) return (
    <main style={{ ...s.page, alignItems: 'flex-start', paddingTop: 24 }}>
      <div style={{ ...s.card, maxWidth: 540, textAlign: 'left' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{receipt.merchant ?? 'Receipt'}</h2>
          <span style={{ fontSize: 22, fontWeight: 800, color: TEAL }}>€{receipt.total.toFixed(2)}</span>
        </div>
        {receipt.warning && (
          <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>⚠ Totals don't match — check items below</p>
        )}

        <div style={s.divider} />

        {/* Equal split toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontSize: 14, color: '#555' }}>Equal split</span>
          <div onClick={() => setEqualSplit(e => !e)} style={{
            width: 44, height: 24, borderRadius: 12,
            background: equalSplit ? TEAL : '#ddd',
            position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
          }}>
            <div style={{
              position: 'absolute', top: 4, left: equalSplit ? 24 : 4,
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>

        {/* People */}
        <p style={s.label}>WHO'S AT THE TABLE</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {people.map(p => (
            <div key={p.id} style={{ ...s.chip, display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.name}
              <span onClick={() => removePerson(p.id)} style={{ cursor: 'pointer', color: '#999', fontSize: 12 }}>✕</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
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

        {/* Items */}
        {!equalSplit && (
          <>
            <p style={s.label}>ASSIGN ITEMS</p>
            {receipt.items.map(item => {
              const assignees = assignments[item.id] ?? [];
              return (
                <div key={item.id} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {item.description}
                      {item.quantity > 1 && <span style={{ color: '#999', fontWeight: 400 }}> ×{item.quantity}</span>}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>€{item.line_total.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {people.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>Add people above to assign</span>}
                    {people.map(p => {
                      const on = assignees.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => toggleAssign(item.id, p.id)} style={{
                          ...s.chip,
                          background: on ? TEAL : '#f0f0f0',
                          color: on ? '#000' : '#555',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 13,
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
              const amount = equalSplit
                ? receipt.total / people.length
                : personTotal(p, assignments, receipt);
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
                  <span>{p.name}</span>
                  <span style={{ fontWeight: 700 }}>€{amount.toFixed(2)}</span>
                </div>
              );
            })}
            {receipt.tax > 0 && (
              <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>Tax & tip distributed proportionally</p>
            )}
          </div>
        )}

        <button
          style={{ ...s.btn, opacity: people.length === 0 ? 0.4 : 1 }}
          disabled={people.length === 0}
          onClick={() => setScreen('confirm')}
        >
          Review & Send →
        </button>
      </div>
    </main>
  );

  // ── CONFIRM ───────────────────────────────────────────────────────────────

  if (screen === 'confirm' && receipt) return (
    <main style={s.page}>
      <div style={s.card}>
        <h2 style={{ ...s.title, fontSize: 22, marginBottom: 4 }}>Send Requests</h2>
        <p style={{ ...s.sub, marginBottom: 24 }}>Each person gets a bunq payment request</p>

        {people.map(p => {
          const amount = equalSplit
            ? receipt.total / people.length
            : personTotal(p, assignments, receipt);
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</p>
                <p style={{ fontSize: 12, color: '#aaa' }}>{p.alias}</p>
              </div>
              <span style={{ fontWeight: 800, fontSize: 18 }}>€{amount.toFixed(2)}</span>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={() => setScreen('assign')} style={{ ...s.btn, background: '#eee', color: '#333', flex: 1 }}>
            ← Back
          </button>
          <button onClick={sendRequests} disabled={sending} style={{ ...s.btn, flex: 2, opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending…' : '💸  Send All'}
          </button>
        </div>
      </div>
    </main>
  );

  // ── DONE ──────────────────────────────────────────────────────────────────

  if (screen === 'done') return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
        <h2 style={{ ...s.title, fontSize: 22, marginBottom: 4 }}>Requests Sent</h2>
        <p style={{ ...s.sub, marginBottom: 24 }}>Everyone will get a bunq notification</p>

        {results.map(r => (
          <div key={r.personId} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{r.name}</span>
            <span style={{ fontSize: 14, marginRight: 10 }}>€{r.amount.toFixed(2)}</span>
            <span>{r.status === 'success' ? '✅' : '❌'}</span>
          </div>
        ))}

        <button style={{ ...s.btn, marginTop: 24 }} onClick={() => {
          setScreen('capture');
          setReceipt(null);
          setPeople([]);
          setAssignments({});
          setResults([]);
        }}>
          Split Another Bill
        </button>
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
    display: 'block',
    width: '100%',
    padding: '14px 20px',
    background: TEAL,
    color: '#000',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
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
