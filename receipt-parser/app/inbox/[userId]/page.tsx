'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TOK, FONT_DISPLAY, FONT_MONO } from '@/lib/design/tokens';
import { ICN } from '@/lib/design/icons';
import {
  Avatar, Money, Sparkline, DonutChart, BarChart,
  BottomNav, type NavTab,
} from '@/lib/design/primitives';

// ─── types ──────────────────────────────────────────────────────────────────

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

interface User { id: string; name: string; email: string; color: string }
interface InboxResponse { user: User; items: InboxItem[] }

type View = NavTab | 'snap-inbox';

// ─── mock messages (mixed feed for demo polish) ────────────────────────────

interface MockMsg {
  id: string;
  kind: 'payment' | 'system' | 'chat';
  sender: string;
  color: string;
  title: string;
  preview: string;
  time: string;
  unread?: boolean;
  isApp?: boolean;
}

const MOCK: MockMsg[] = [
  { id: 'pay1', kind: 'payment', sender: 'Sofia Reyes', color: TOK.rose,  title: 'Sofia Reyes',     preview: '↙ Sent you €12.00 · "coffee ☕"',       time: '1h' },
  { id: 'sys1', kind: 'system',  sender: 'Card delivery', color: TOK.ocean, title: 'Your new card has shipped', preview: 'Arriving Wed, Apr 30 · Track package', time: '3h', isApp: true },
  { id: 'pay2', kind: 'payment', sender: 'Liam Park',  color: TOK.amber, title: 'Liam Park',       preview: '↗ You paid €45.00 · "rent share"',     time: 'Yesterday' },
  { id: 'chat1', kind: 'chat',   sender: 'Support',    color: TOK.ocean, title: 'bunq Support',    preview: 'Re: card replacement — all sorted! 🎉', time: 'Mon', isApp: true },
];

// ─── helpers ────────────────────────────────────────────────────────────────

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function splitMoney(amount: number): [string, string] {
  const whole = Math.floor(amount).toLocaleString();
  const cents = String(Math.round((amount % 1) * 100)).padStart(2, '0');
  return [whole, cents];
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function DashboardPage({ params }: { params: { userId: string } }) {
  const router = useRouter();
  const [view, setView] = useState<View>('home');
  const [data, setData] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<InboxItem | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  // Poll inbox every 2s
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

        const currentPendingIds = new Set(fresh.items.filter((i) => i.status === 'pending').map((i) => i.sessionId));
        if (firstLoadRef.current) {
          currentPendingIds.forEach((id) => seenRef.current.add(id));
          firstLoadRef.current = false;
        } else {
          for (const item of fresh.items) {
            if (item.status === 'pending' && !seenRef.current.has(item.sessionId)) {
              seenRef.current.add(item.sessionId);
              setPopup(item);
            }
          }
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
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: TOK.bg, padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700 }}>{error}</h2>
        <p style={{ color: TOK.textDim, fontSize: 14, marginTop: 8 }}>Try /inbox to see available users.</p>
      </div>
    </main>
  );

  if (!data) return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: TOK.bg }}>
      <p style={{ color: TOK.textDim, fontSize: 14 }}>Loading…</p>
    </main>
  );

  const pendingCount = data.items.filter((i) => i.status === 'pending').length;
  const totalUnread = pendingCount + MOCK.filter((m) => m.unread).length;

  return (
    <main style={{
      minHeight: '100vh', background: TOK.bg, color: TOK.text,
      maxWidth: 440, margin: '0 auto', position: 'relative',
      paddingBottom: 100,
    }}>
      {view === 'home'         && <HomeView user={data.user} pendingCount={pendingCount} onSplit={() => router.push('/')} onOpenSnap={() => setView('snap-inbox')} />}
      {view === 'msgs'         && <MessagesView user={data.user} items={data.items} onOpenSnap={() => setView('snap-inbox')} onOpenItem={openSplit} />}
      {view === 'snap-inbox'   && <SnapInboxView user={data.user} items={data.items} onBack={() => setView('msgs')} onOpen={openSplit} />}
      {view === 'stats'        && <PlaceholderView title="Insights" />}
      {view === 'cards'        && <PlaceholderView title="Cards" />}
      {view === 'me'           && <PlaceholderView title="Profile" user={data.user} />}

      <BottomNav active={view === 'snap-inbox' ? 'msgs' : view as NavTab} messageBadge={totalUnread} onNavigate={(t) => setView(t)} />

      {popup && <NotificationPopup item={popup} onDismiss={() => setPopup(null)} onOpen={() => openSplit(popup)} />}
    </main>
  );
}

// ─── HOME VIEW ──────────────────────────────────────────────────────────────

function HomeView({ user, pendingCount, onSplit, onOpenSnap }: {
  user: User; pendingCount: number; onSplit: () => void; onOpenSnap: () => void;
}) {
  const accent = TOK.accent;
  const sparkData = [2010, 2120, 2055, 2180, 2240, 2190, 2310, 2280, 2375, 2420, 2433];
  const categories = [
    { label: 'Food & drink', value: 412, color: TOK.amber },
    { label: 'Transport',    value: 188, color: TOK.ocean },
    { label: 'Shopping',     value: 256, color: TOK.rose },
    { label: 'Bills',        value: 320, color: TOK.plum },
    { label: 'Splits',       value: 94,  color: accent },
  ];
  const weekly = [
    { label: 'M', value: 32 }, { label: 'T', value: 58 }, { label: 'W', value: 41 },
    { label: 'T', value: 89 }, { label: 'F', value: 67 }, { label: 'S', value: 124 }, { label: 'S', value: 48 },
  ];
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <>
      {/* Top bar */}
      <div style={{ padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `conic-gradient(from 200deg, ${accent}, ${TOK.teal}, ${TOK.plum}, ${TOK.rose}, ${TOK.amber}, ${accent})`,
          padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '100%', height: '100%', borderRadius: '50%',
            background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 14, color: user.color,
          }}>{user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={iconBtn}>
            {ICN.bell()}
            {pendingCount > 0 && <div style={{ position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: '50%', background: accent, border: `2px solid ${TOK.surface}` }} />}
          </button>
          <button style={iconBtn} onClick={onSplit}>{ICN.scan()}</button>
        </div>
      </div>

      {/* Greeting */}
      <div style={{ padding: '12px 20px 0' }}>
        <p style={{ fontSize: 13, color: TOK.textDim }}>{greeting}, {user.name.split(' ')[0]}</p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>Home</h1>
      </div>

      {/* Hero balance card */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 22, padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -60, right: -60, width: 160, height: 160, borderRadius: '50%', background: accent, opacity: 0.12, filter: 'blur(40px)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: TOK.textDim, fontFamily: FONT_MONO }}>TOTAL · 3 ACCOUNTS</p>
              <Money whole="2,433" cents="00" size={36} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: TOK.mint, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 8l4-4 4 4" stroke={TOK.mint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  +€423 (21%)
                </span>
                <span style={{ fontSize: 11, color: TOK.textFaint }}>vs last month</span>
              </div>
            </div>
            <span style={{ padding: '5px 10px', borderRadius: 999, background: TOK.surface2, border: `1px solid ${TOK.border}`, color: TOK.text, fontSize: 11, fontWeight: 700 }}>30d</span>
          </div>
          <div style={{ marginTop: 14, marginInline: -4 }}>
            <Sparkline data={sparkData} color={accent} height={60} />
          </div>
        </div>
      </div>

      {/* Account tiles */}
      <div style={{ padding: '12px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Main',    amt: '€900',   bg: 'linear-gradient(135deg,#B45309,#F59E0B)' },
          { label: 'Vacay',   amt: '€1,210', bg: 'linear-gradient(135deg,#0F766E,#14B8A6)' },
          { label: 'Savings', amt: '€310',   bg: 'linear-gradient(135deg,#047857,#10B981)' },
        ].map((a) => (
          <div key={a.label} style={{ background: a.bg, borderRadius: 14, padding: 10, height: 64, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.9 }}>{a.label}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>{a.amt}</span>
          </div>
        ))}
      </div>

      {/* Donut + bars */}
      <div style={{ padding: '12px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 18, padding: 12 }}>
          <p style={mono10}>BY CATEGORY</p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <DonutChart data={categories} size={110} stroke={12} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {categories.slice(0, 3).map((c) => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: c.color }} />
                <span style={{ flex: 1, color: TOK.textDim }}>{c.label}</span>
                <span style={{ fontFamily: FONT_MONO, color: TOK.text, fontWeight: 600 }}>€{c.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 18, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <p style={mono10}>THIS WEEK</p>
            <span style={{ fontSize: 10, color: TOK.textFaint, fontFamily: FONT_MONO }}>€459</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <BarChart data={weekly} accent={accent} height={70} budget={80} />
          </div>
        </div>
      </div>

      {/* Cashflow */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 18, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <p style={mono10}>CASHFLOW · APRIL</p>
            <span style={{ fontSize: 10, color: TOK.mint, fontFamily: FONT_MONO, fontWeight: 700 }}>+€874 NET</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 3.2, height: 28, borderRadius: 8, background: `linear-gradient(90deg, ${TOK.mint}, ${TOK.mint}aa)`, display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: '#000' }}>€3,210 in</span>
            </div>
            <div style={{ flex: 2.4, height: 28, borderRadius: 8, background: 'rgba(239,68,68,0.7)', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: '#fff' }}>€2,336 out</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 10, color: TOK.textDim }}>
            <span>↓ Salary, refunds</span>
            <span style={{ marginLeft: 'auto' }}>↑ Bills, food, splits</span>
          </div>
        </div>
      </div>

      {/* Splits widget — REAL data */}
      <div style={{ padding: '12px 20px 0' }}>
        <button onClick={onOpenSnap} style={{
          width: '100%', textAlign: 'left',
          background: `linear-gradient(135deg, ${accent}18 0%, ${accent}05 100%)`,
          border: `1px solid ${accent}55`, borderRadius: 18, padding: 14,
          cursor: 'pointer',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>🧾</span>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: accent, fontFamily: FONT_MONO }}>SNAPSPLIT</p>
            </div>
            <span style={{ fontSize: 10, color: TOK.textDim }}>{pendingCount} pending</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: TOK.textDim, fontFamily: FONT_MONO }}>WAITING ON YOU</p>
              <Money whole={String(pendingCount * 18)} cents="00" size={20} color={pendingCount > 0 ? accent : TOK.textFaint} />
            </div>
            <div style={{ width: 1, background: TOK.border }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: TOK.textDim, fontFamily: FONT_MONO }}>LIFETIME PAID</p>
              <Money whole="142" cents="80" size={20} color={TOK.text} />
            </div>
          </div>
          <p style={{ fontSize: 10, color: TOK.textFaint, marginTop: 10 }}>
            {pendingCount > 0 ? <>● {pendingCount} need{pendingCount === 1 ? 's' : ''} your attention →</> : 'You\'re all caught up'}
          </p>
        </button>
      </div>

      {/* Goals */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 18, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <p style={mono10}>SAVINGS GOALS</p>
            <span style={{ fontSize: 10, color: TOK.textFaint }}>2 of 3 on track</span>
          </div>
          {[
            { label: '🏝️ Summer Vacay',  cur: 1210, goal: 2000,  color: TOK.teal },
            { label: '🏠 House deposit', cur: 4400, goal: 12000, color: TOK.plum },
          ].map((g) => (
            <div key={g.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{g.label}</span>
                <span style={{ fontSize: 10, color: TOK.textDim, fontFamily: FONT_MONO }}>€{g.cur.toLocaleString()} / €{g.goal.toLocaleString()}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: TOK.surface2, overflow: 'hidden' }}>
                <div style={{ width: `${(g.cur / g.goal) * 100}%`, height: '100%', background: g.color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ padding: '14px 20px 0', display: 'flex', justifyContent: 'space-around' }}>
        {[
          { label: 'Pay',     bg: TOK.amber,  icn: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg> },
          { label: 'Request', bg: TOK.ocean,  icn: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg> },
          { label: 'Split',   bg: accent,     icn: ICN.receipt('#000'), highlight: true, onClick: onSplit },
          { label: 'Add',     bg: TOK.rose,   icn: ICN.plus('#000') },
        ].map((a) => (
          <div key={a.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button onClick={a.onClick} style={{
              width: 48, height: 48, borderRadius: '50%', background: a.bg, border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              boxShadow: a.highlight ? `0 0 0 3px ${TOK.bg}, 0 0 0 5px ${accent}40` : 'none',
            }}>{a.icn}</button>
            <span style={{ fontSize: 10, fontWeight: 600 }}>{a.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── MESSAGES VIEW ──────────────────────────────────────────────────────────

function MessagesView({ user, items, onOpenSnap, onOpenItem }: {
  user: User; items: InboxItem[];
  onOpenSnap: () => void;
  onOpenItem: (i: InboxItem) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'snapsplit' | 'payment' | 'chat'>('all');

  // Compose unified feed: real SnapSplit invites + mock messages, sorted by recency
  const snapMsgs = items.map((i) => ({
    id: 'snap-' + i.sessionId,
    kind: 'snapsplit' as const,
    sender: i.hostName,
    color: hashColor(i.hostName),
    title: `${i.hostName} wants to split`,
    preview: `${i.merchant ?? 'Receipt'} · ${formatAmount(i.total, i.currency)} · tap to review`,
    time: timeAgo(i.createdAt),
    unread: i.status === 'pending',
    item: i,
  }));

  const all = [
    ...snapMsgs,
    ...MOCK.map((m) => ({ ...m, item: undefined })),
  ];

  const visible = filter === 'all' ? all : all.filter((m) => {
    if (filter === 'chat') return m.kind === 'chat' || m.kind === 'system';
    if (filter === 'snapsplit') return m.kind === 'snapsplit';
    if (filter === 'payment') return m.kind === 'payment';
    return true;
  });

  const filters = [
    { id: 'all',       label: 'All',       count: all.length },
    { id: 'snapsplit', label: 'SnapSplit', count: snapMsgs.length },
    { id: 'payment',   label: 'Payments',  count: MOCK.filter((m) => m.kind === 'payment').length },
    { id: 'chat',      label: 'Chats',     count: MOCK.filter((m) => m.kind === 'chat' || m.kind === 'system').length },
  ] as const;

  const pendingSnaps = snapMsgs.filter((m) => m.unread);

  return (
    <>
      <div style={{ padding: '20px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `conic-gradient(from 200deg, ${TOK.accent}, ${TOK.teal}, ${TOK.plum}, ${TOK.rose}, ${TOK.amber}, ${TOK.accent})`,
          padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '100%', height: '100%', borderRadius: '50%',
            background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 14, color: user.color,
          }}>{user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={iconBtn}>{ICN.search()}</button>
          <button style={{ ...iconBtn, background: TOK.accent, border: 'none', color: TOK.accentInk }}>{ICN.plus(TOK.accentInk)}</button>
        </div>
      </div>

      <div style={{ padding: '18px 20px 0' }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>Messages</h1>
        <p style={{ fontSize: 13, color: TOK.textDim, marginTop: 6 }}>Splits, payments, and chats — all in one place</p>
      </div>

      {/* Filter chips */}
      <div style={{ padding: '18px 20px 14px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {filters.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '7px 14px', borderRadius: 999, whiteSpace: 'nowrap',
            background: filter === f.id ? TOK.text : TOK.surface,
            color: filter === f.id ? TOK.accentInk : TOK.text,
            border: `1px solid ${filter === f.id ? TOK.text : TOK.border}`,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {f.label}
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '0 6px', borderRadius: 8,
              background: filter === f.id ? `${TOK.accentInk}22` : TOK.surface2,
              color: filter === f.id ? TOK.accentInk : TOK.textDim,
              fontFamily: FONT_MONO,
            }}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* SnapSplit summary banner — if there are pending splits, prompt action */}
      {pendingSnaps.length > 0 && (
        <div style={{ padding: '0 20px 8px' }}>
          <button onClick={onOpenSnap} style={{
            width: '100%', textAlign: 'left',
            background: `${TOK.accent}10`, border: `1px solid ${TOK.accent}40`,
            borderRadius: 14, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: 'pointer',
          }}>
            <div style={{ color: TOK.accent }}>{ICN.doubleCheck(TOK.accent)}</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: TOK.text }}>
                {pendingSnaps.length} split{pendingSnaps.length === 1 ? '' : 's'} need{pendingSnaps.length === 1 ? 's' : ''} your action
              </p>
              <p style={{ fontSize: 11, color: TOK.textDim, marginTop: 1 }}>
                Tap to review and pay
              </p>
            </div>
            <span style={{ color: TOK.accent, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3 }}>VIEW {ICN.chevR(TOK.accent)}</span>
          </button>
        </div>
      )}

      {/* Feed */}
      <div>
        {visible.map((m) => (
          <MessageRow key={m.id} m={m as never} onClick={() => {
            if (m.kind === 'snapsplit') {
              if (m.item) onOpenItem(m.item);
            }
          }} />
        ))}
        {visible.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: TOK.textDim }}>No messages in this filter yet.</p>
          </div>
        )}
      </div>
    </>
  );
}

interface FeedItem {
  id: string;
  kind: 'snapsplit' | 'payment' | 'system' | 'chat';
  sender: string;
  color: string;
  title: string;
  preview: string;
  time: string;
  unread?: boolean;
}

function MessageRow({ m, onClick }: { m: FeedItem; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', gap: 12, alignItems: 'center',
      padding: '14px 20px', background: 'transparent',
      border: 'none', cursor: 'pointer', textAlign: 'left',
      borderBottom: `1px solid ${TOK.border}`,
      color: TOK.text, position: 'relative',
    }}>
      {m.unread && (
        <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 6, height: 6, borderRadius: '50%', background: TOK.accent }} />
      )}
      <div style={{ position: 'relative' }}>
        <Avatar name={m.sender} color={m.color} size={44} />
        {m.kind === 'snapsplit' && (
          <div style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%', background: TOK.bg, border: `1.5px solid ${TOK.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10 }}>🧾</span>
          </div>
        )}
        {m.kind === 'payment' && (
          <div style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%', background: TOK.bg, border: `1.5px solid ${TOK.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10 }}>€</span>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <p style={{ fontSize: 14.5, fontWeight: m.unread ? 700 : 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</p>
          <span style={{ fontSize: 11, color: TOK.textFaint, flexShrink: 0, fontFamily: FONT_MONO }}>{m.time}</span>
        </div>
        <p style={{ fontSize: 12.5, color: m.unread ? TOK.text : TOK.textDim, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.preview}
        </p>
      </div>
    </button>
  );
}

// ─── SNAP-INBOX VIEW (drilled in from Messages) ─────────────────────────────

function SnapInboxView({ user, items, onBack, onOpen }: {
  user: User; items: InboxItem[]; onBack: () => void; onOpen: (i: InboxItem) => void;
}) {
  const pending = items.filter((i) => i.status === 'pending');
  const settled = items.filter((i) => i.status !== 'pending');
  const featured = pending[0];

  return (
    <>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={iconBtn}>{ICN.chevL()}</button>
        <span style={{ fontSize: 13, color: TOK.textDim }}>Messages / SnapSplit</span>
      </div>

      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: TOK.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14 }}>🧾</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: TOK.accent, fontFamily: FONT_MONO }}>SNAPSPLIT INBOX</span>
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.05 }}>
          {pending.length > 0 ? <>Splits waiting<br />for you</> : <>All caught up</>}
        </h1>
        <p style={{ fontSize: 13, color: TOK.textDim, marginTop: 8 }}>
          {pending.length} open · {settled.length} settled
        </p>
      </div>

      {/* Featured pending card */}
      {featured && (
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{
            background: `linear-gradient(135deg, ${hashColor(featured.hostName)}40 0%, ${hashColor(featured.hostName)}10 100%)`,
            border: `1px solid ${hashColor(featured.hostName)}66`,
            borderRadius: 22, padding: 18, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%', background: hashColor(featured.hostName), opacity: 0.18, filter: 'blur(20px)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Avatar name={featured.hostName} color={hashColor(featured.hostName)} size={42} />
                <div>
                  <p style={{ fontSize: 11, color: TOK.textDim, fontWeight: 600 }}>FROM</p>
                  <p style={{ fontSize: 15, fontWeight: 700 }}>{featured.hostName}</p>
                </div>
              </div>
              <span style={{ fontSize: 11, color: TOK.textDim, fontFamily: FONT_MONO }}>{timeAgo(featured.createdAt)}</span>
            </div>
            <div style={{ marginTop: 16, position: 'relative' }}>
              <p style={{ fontSize: 12, color: TOK.textDim, marginBottom: 4 }}>{featured.merchant ?? 'Receipt'} · {featured.itemCount} items</p>
              {(() => { const [w, c] = splitMoney(featured.total); return <Money whole={w} cents={c} size={36} />; })()}
            </div>
            <button onClick={() => onOpen(featured)} style={{
              marginTop: 14, width: '100%', padding: '14px',
              background: TOK.accent, border: 'none', borderRadius: 14,
              color: TOK.accentInk, fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              cursor: 'pointer',
            }}>
              Pick what you had {ICN.arrow(TOK.accentInk)}
            </button>
          </div>
        </div>
      )}

      {/* Other pending */}
      {pending.length > 1 && (
        <>
          <div style={{ padding: '18px 20px 8px' }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: TOK.textDim }}>OTHER OPEN ({pending.length - 1})</p>
          </div>
          {pending.slice(1).map((it) => (
            <button key={it.sessionId} onClick={() => onOpen(it)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              margin: '0 20px 8px', padding: '12px 14px',
              background: TOK.surface, border: `1px solid ${TOK.border}`, borderRadius: 14,
              width: 'calc(100% - 40px)', textAlign: 'left', cursor: 'pointer',
              color: TOK.text,
            }}>
              <Avatar name={it.hostName} color={hashColor(it.hostName)} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13.5, fontWeight: 700 }}>{it.hostName}</p>
                <p style={{ fontSize: 11.5, color: TOK.textDim }}>{it.merchant ?? 'Receipt'} · {formatAmount(it.total, it.currency)}</p>
              </div>
              <div style={{ color: TOK.textFaint }}>{ICN.chevR(TOK.textFaint)}</div>
            </button>
          ))}
        </>
      )}

      {/* Earlier */}
      {settled.length > 0 && (
        <>
          <div style={{ padding: '14px 20px 8px' }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: TOK.textDim }}>EARLIER</p>
          </div>
          {settled.map((it) => (
            <div key={it.sessionId} style={{
              margin: '0 20px 6px', padding: '10px 14px',
              borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, opacity: 0.7,
            }}>
              <Avatar name={it.hostName} color={hashColor(it.hostName)} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12.5, fontWeight: 600 }}>{it.hostName} · {it.merchant ?? 'Receipt'}</p>
                <p style={{ fontSize: 11, color: TOK.textFaint }}>{timeAgo(it.createdAt)}</p>
              </div>
              {it.status === 'paid' ? (
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999,
                  background: `${TOK.mint}22`, color: TOK.mint, border: `1px solid ${TOK.mint}55`,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>{ICN.check(TOK.mint)} {it.amountPaid != null ? formatAmount(it.amountPaid, it.currency) : ''}</span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: TOK.surface2, color: TOK.textDim }}>SKIPPED</span>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ─── PLACEHOLDER VIEWS for nav tabs we don't need to build ─────────────────

function PlaceholderView({ title, user }: { title: string; user?: User }) {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700 }}>{title}</h1>
      <p style={{ fontSize: 13, color: TOK.textDim, marginTop: 12 }}>
        {user ? `Hi ${user.name} 👋 — coming soon` : 'Coming soon'}
      </p>
    </div>
  );
}

// ─── NOTIFICATION POPUP ────────────────────────────────────────────────────

function NotificationPopup({ item, onDismiss, onOpen }: {
  item: InboxItem; onDismiss: () => void; onOpen: () => void;
}) {
  return (
    <div onClick={onDismiss} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 60, padding: 16,
      zIndex: 100, animation: 'fadeIn 0.2s',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: TOK.surface, border: `1px solid ${TOK.borderHi}`,
        borderRadius: 18, padding: 22, maxWidth: 380, width: '100%',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        animation: 'slideDown 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, fontWeight: 800, color: TOK.accent,
          fontFamily: FONT_MONO, letterSpacing: '0.08em', marginBottom: 12,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: TOK.accent, animation: 'pulse 1.2s infinite' }} />
          NEW REQUEST · BUNQ
        </div>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          💸 {item.hostName} needs you
        </h3>
        <p style={{ fontSize: 14, color: TOK.textDim, marginBottom: 4 }}>
          Asking you to chip in for <strong style={{ color: TOK.text }}>{item.merchant ?? 'a receipt'}</strong>
        </p>
        <p style={{ fontSize: 13, color: TOK.textFaint, marginBottom: 20 }}>
          Total: {formatAmount(item.total, item.currency)} · {item.itemCount} items
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDismiss} style={{
            flex: 1, padding: '12px',
            background: TOK.surface2, color: TOK.textDim,
            border: `1px solid ${TOK.border}`, borderRadius: 10,
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Later</button>
          <button onClick={onOpen} style={{
            flex: 2, padding: '12px',
            background: TOK.accent, color: TOK.accentInk,
            border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 800, cursor: 'pointer',
          }}>Review receipt →</button>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function hashColor(s: string): string {
  const palette = [TOK.plum, TOK.amber, TOK.teal, TOK.rose, TOK.ocean, TOK.lime, TOK.violet, TOK.mint];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  background: TOK.surface, border: `1px solid ${TOK.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: TOK.text, cursor: 'pointer', position: 'relative',
};

const mono10: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  color: TOK.textDim, fontFamily: FONT_MONO, marginBottom: 6,
};
