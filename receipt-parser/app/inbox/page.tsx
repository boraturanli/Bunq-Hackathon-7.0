'use client';

import { useEffect, useState } from 'react';
import { TOK, FONT_DISPLAY, FONT_MONO } from '@/lib/design/tokens';
import { ICN } from '@/lib/design/icons';
import { Avatar } from '@/lib/design/primitives';

interface TopFriend {
  id: string; name: string; email: string; color: string;
  iban: string | null; pointer_type: string; pointer_value: string;
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
    window.open(`/inbox/${id}`, '_blank', 'noopener,noreferrer');
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
      window.open(`/inbox/${user.id}`, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setOpening(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: TOK.bg, color: TOK.text, padding: 20 }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Top bar */}
        <div style={{ paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: TOK.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 14, color: TOK.accentInk,
            }}>S</div>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>bunqShare</span>
          </div>
          <a href="/" style={{ fontSize: 11, fontWeight: 700, color: TOK.textDim }}>← Host page</a>
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
            DEMO LOBBY
          </span>
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>
          Stage your<br />demo tabs
        </h1>
        <p style={{ fontSize: 14, color: TOK.textDim, marginTop: 10, lineHeight: 1.5 }}>
          Open one inbox per browser tab to simulate each user.
          Then go back to the host page and pick the same friends.
        </p>

        {/* Hint */}
        <div style={{
          marginTop: 24, padding: '12px 14px', borderRadius: 14,
          background: `${TOK.amber}15`, border: `1px solid ${TOK.amber}40`,
          fontSize: 12, color: TOK.amber,
        }}>
          💡 First time? Run <code style={{ background: TOK.surface, padding: '1px 5px', borderRadius: 4, color: TOK.text, fontFamily: FONT_MONO, fontSize: 11 }}>python seed_demo_friends.py</code> in the sandbox folder so top contacts are populated.
        </div>

        {loading && <p style={{ color: TOK.textDim, fontSize: 14, marginTop: 24 }}>Loading top friends…</p>}
        {error && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: `${TOK.scarlet}20`, border: `1px solid ${TOK.scarlet}55`, borderRadius: 12, color: TOK.scarlet, fontSize: 13 }}>
            {error} — is the bunq sandbox API running on port 8000?
          </div>
        )}

        {!loading && friends.length > 0 && (
          <>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: TOK.textDim, fontFamily: FONT_MONO, marginTop: 28, marginBottom: 12 }}>
              TOP FRIENDS · FROM BUNQ
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {friends.map((f) => (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 14,
                }}>
                  <Avatar name={f.name} color={f.color} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</p>
                    <p style={{ fontSize: 11, color: TOK.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: FONT_MONO }}>
                      {f.pointer_value} · {f.transaction_count}×
                    </p>
                  </div>
                  <button onClick={() => openInbox(f.id)} style={{
                    background: TOK.accent, color: TOK.accentInk,
                    border: 'none', borderRadius: 10,
                    padding: '8px 14px', fontSize: 12, fontWeight: 800,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  }}>↗ Open inbox</button>
                </div>
              ))}
            </div>
          </>
        )}

        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: TOK.textDim, fontFamily: FONT_MONO, marginTop: 28, marginBottom: 8 }}>
          ADD A CUSTOM USER
        </p>
        <p style={{ fontSize: 12, color: TOK.textDim, marginBottom: 12 }}>
          Open an inbox for someone not in your bunq history. Use the same name + email when you add them on the host page.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={input} placeholder="Name (e.g. Guido)" value={customName} onChange={(e) => setCustomName(e.target.value)} />
          <input style={input} placeholder="Email" value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && openCustom()} />
        </div>
        <button onClick={openCustom} disabled={!customName.trim() || !customEmail.trim() || opening} style={{
          width: '100%', padding: '14px',
          background: TOK.accent, color: TOK.accentInk,
          border: 'none', borderRadius: 14,
          fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700,
          cursor: 'pointer',
          opacity: !customName.trim() || !customEmail.trim() || opening ? 0.4 : 1,
        }}>
          {opening ? 'Opening…' : '↗ Open custom inbox'}
        </button>
      </div>
    </main>
  );
}

const input: React.CSSProperties = {
  flex: 1,
  padding: '12px 14px',
  background: TOK.surface,
  border: `1px solid ${TOK.border}`,
  borderRadius: 12,
  color: TOK.text,
  fontSize: 14,
  minWidth: 0,
  fontFamily: 'inherit',
};
