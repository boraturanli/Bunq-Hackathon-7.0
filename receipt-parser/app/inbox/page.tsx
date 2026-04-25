'use client';

import { useEffect, useState } from 'react';

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

export default function InboxLobby() {
  const [friends, setFriends] = useState<TopFriend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [customName, setCustomName] = useState('');
  const [customEmail, setCustomEmail] = useState('');
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    fetch('/api/contacts/top?n=5', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(setFriends)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const openInbox = (id: string) => {
    const tab = window.open(`/inbox/${id}`, '_blank', 'noopener,noreferrer');
    if (tab) window.focus();
  };

  const openCustom = async () => {
    if (!customName.trim() || !customEmail.trim()) return;
    setOpening(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: customName.trim(), email: customEmail.trim(), source: 'custom' }),
      });
      if (!res.ok) throw new Error('Failed to register');
      const user = await res.json();
      const tab = window.open(`/inbox/${user.id}`, '_blank', 'noopener,noreferrer');
      if (tab) window.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setOpening(false);
    }
  };

  return (
    <main style={s.page}>
      <div style={{ ...s.card, maxWidth: 560 }}>
        <h1 style={s.title}>Demo Lobby</h1>
        <p style={s.sub}>
          Open one inbox per browser tab to simulate each user. Then go back to the host page and pick the same friends.
        </p>

        <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#8a6d00', textAlign: 'left' }}>
          💡 First time? Run <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 4 }}>python seed_demo_friends.py</code> in the sandbox folder so top contacts are populated.
        </div>

        {loading && <p style={{ ...s.sub, marginBottom: 16 }}>Loading top friends…</p>}

        {error && (
          <p style={{ ...s.error, marginBottom: 20 }}>
            {error} — is the bunq sandbox API running on port 8000?
          </p>
        )}

        {!loading && friends.length > 0 && (
          <>
            <p style={s.label}>TOP FRIENDS · FROM BUNQ</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {friends.map((f) => (
                <div key={f.id} style={s.row}>
                  <div style={{ ...s.avatar, background: f.color }}>{f.name[0]}</div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <p style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</p>
                    <p style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.pointer_value} · {f.transaction_count} txns
                    </p>
                  </div>
                  <button onClick={() => openInbox(f.id)} style={s.openBtn}>
                    ↗ Open inbox
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <p style={s.label}>ADD A CUSTOM USER</p>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12, textAlign: 'left' }}>
          Open an inbox for someone not in your bunq history. Use the same name + email when you add them on the host page.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            style={s.input}
            placeholder="Name (e.g. Guido)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <input
            style={s.input}
            placeholder="Email"
            value={customEmail}
            onChange={(e) => setCustomEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && openCustom()}
          />
        </div>
        <button
          onClick={openCustom}
          disabled={!customName.trim() || !customEmail.trim() || opening}
          style={{ ...s.btn, opacity: !customName.trim() || !customEmail.trim() || opening ? 0.4 : 1 }}
        >
          {opening ? 'Opening…' : '↗ Open custom inbox'}
        </button>

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #eee' }}>
          <a href="/" style={{ color: TEAL, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
            ← Go to host page
          </a>
        </div>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f4f4', padding: 16 },
  card: { background: '#fff', borderRadius: 20, padding: 32, width: '100%', boxShadow: '0 4px 32px rgba(0,0,0,0.07)' },
  title: { fontSize: 26, fontWeight: 800, marginBottom: 6 },
  sub: { fontSize: 14, color: '#888', marginBottom: 24 },
  error: { color: '#ef4444', fontSize: 13 },
  label: { fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '0.08em', marginBottom: 10, textAlign: 'left' as const },
  row: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px',
    background: '#fafafa', border: '1px solid #eee', borderRadius: 12,
  },
  avatar: {
    width: 38, height: 38, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#000', flexShrink: 0,
  },
  openBtn: {
    background: TEAL, color: '#000',
    border: 'none', borderRadius: 8,
    padding: '8px 14px', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', flexShrink: 0,
  },
  btn: {
    display: 'block', width: '100%',
    padding: '12px 20px',
    background: TEAL, color: '#000',
    border: 'none', borderRadius: 12,
    fontSize: 15, fontWeight: 700, cursor: 'pointer',
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
};
