'use client';

import React from 'react';
import { TOK, FONT_DISPLAY, FONT_MONO } from './tokens';
import { ICN } from './icons';

// ── Phone shell (status bar + home indicator framing for mobile-first) ──────

export const StatusBar = ({ dark = true }: { dark?: boolean }) => (
  <div style={{
    height: 44, padding: '14px 28px 0',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 15, fontWeight: 600,
    color: dark ? TOK.text : '#000',
    flexShrink: 0,
  }}>
    <span style={{ letterSpacing: '-0.01em' }}>9:41</span>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 12, letterSpacing: '0.5px' }}>●●●●</span>
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path d="M0 8.5L2 6.5L4 8.5L6 5L8 8L10 4.5L12 7L14 3L16 6" stroke={dark ? '#fff' : '#000'} strokeWidth="1.5" fill="none" />
      </svg>
      <div style={{ width: 24, height: 11, border: `1px solid ${dark ? '#fff' : '#000'}`, borderRadius: 3, padding: 1, opacity: 0.9 }}>
        <div style={{ width: '85%', height: '100%', background: dark ? '#fff' : '#000', borderRadius: 1 }} />
      </div>
    </div>
  </div>
);

export const HomeIndicator = ({ dark = true }: { dark?: boolean }) => (
  <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
    <div style={{ width: 134, height: 5, borderRadius: 3, background: dark ? '#fff' : '#000', opacity: 0.95 }} />
  </div>
);

// ── Bottom navigation ───────────────────────────────────────────────────────

export type NavTab = 'home' | 'msgs' | 'stats' | 'cards' | 'me';

const NavItem = ({ icon, label, active, badge, onClick }: {
  icon: React.ReactElement; label: string; active?: boolean; badge?: number | null; onClick?: () => void;
}) => (
  <button onClick={onClick} style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    flex: 1, position: 'relative',
    color: active ? TOK.accent : TOK.textFaint,
    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
  }}>
    <div style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center' }}>
      {icon}
      {badge ? (
        <div style={{
          position: 'absolute', top: -4, right: -8,
          minWidth: 16, height: 16, padding: '0 4px',
          background: TOK.accent, color: TOK.accentInk,
          borderRadius: 8, fontSize: 10, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT_MONO,
          border: `2px solid ${TOK.bg}`,
        }}>{badge}</div>
      ) : null}
    </div>
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em' }}>{label}</span>
  </button>
);

export const BottomNav = ({ active = 'home', messageBadge = 0, onNavigate }: {
  active?: NavTab; messageBadge?: number; onNavigate?: (tab: NavTab) => void;
}) => (
  <div style={{
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 10, paddingBottom: 28,
    background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, rgba(0,0,0,0))',
    backdropFilter: 'blur(20px)',
    display: 'flex', justifyContent: 'space-around', alignItems: 'center',
    borderTop: `1px solid ${TOK.border}`,
    zIndex: 10,
  }}>
    <NavItem icon={ICN.home(active === 'home' ? TOK.accent : TOK.textFaint)} label="Home"     active={active === 'home'}  onClick={() => onNavigate?.('home')} />
    <NavItem icon={ICN.message(active === 'msgs' ? TOK.accent : TOK.textFaint)} label="Messages" active={active === 'msgs'}  badge={messageBadge || null} onClick={() => onNavigate?.('msgs')} />
    <NavItem icon={ICN.insight(active === 'stats' ? TOK.accent : TOK.textFaint)} label="Insights" active={active === 'stats'} onClick={() => onNavigate?.('stats')} />
    <NavItem icon={ICN.card(active === 'cards' ? TOK.accent : TOK.textFaint)} label="Cards"    active={active === 'cards'} onClick={() => onNavigate?.('cards')} />
    <NavItem icon={ICN.user(active === 'me' ? TOK.accent : TOK.textFaint)} label="Me"       active={active === 'me'}    onClick={() => onNavigate?.('me')} />
  </div>
);

// ── Avatar ──────────────────────────────────────────────────────────────────

export const Avatar = ({ name, color, size = 44, online }: {
  name: string; color: string; size?: number; online?: boolean;
}) => (
  <div style={{
    width: size, height: size, borderRadius: '50%',
    background: color, color: '#000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: size * 0.4,
    flexShrink: 0, position: 'relative',
  }}>
    {name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
    {online && (
      <div style={{
        position: 'absolute', bottom: 0, right: 0,
        width: size * 0.28, height: size * 0.28, borderRadius: '50%',
        background: TOK.mint, border: `2px solid ${TOK.bg}`,
      }} />
    )}
  </div>
);

// ── Money display ──────────────────────────────────────────────────────────

export const Money = ({ whole, cents, size = 28, color = '#fff', weight = 700, currency = '€' }: {
  whole: string | number; cents: string | number; size?: number; color?: string; weight?: number; currency?: string;
}) => (
  <div style={{
    color, fontFamily: FONT_DISPLAY, fontWeight: weight, letterSpacing: '-0.03em',
    display: 'flex', alignItems: 'baseline', gap: 1,
  }}>
    <span style={{ fontSize: size * 0.7, opacity: 0.85, marginRight: 2 }}>{currency}</span>
    <span style={{ fontSize: size }}>{whole}</span>
    <span style={{ fontSize: size * 0.5, opacity: 0.85 }}>.{cents}</span>
  </div>
);

// ── Sparkline ──────────────────────────────────────────────────────────────

export const Sparkline = ({ data, color, width = 320, height = 70 }: {
  data: number[]; color: string; width?: number; height?: number;
}) => {
  const min = Math.min(...data), max = Math.max(...data);
  const norm = (v: number) => height - 8 - ((v - min) / (max - min || 1)) * (height - 16);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, norm(v)] as [number, number]);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];
  const gradId = `spark-${color.replace('#', '')}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={d} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} />
      <circle cx={last[0]} cy={last[1]} r="7"   fill={color} opacity="0.25" />
    </svg>
  );
};

// ── Donut chart ────────────────────────────────────────────────────────────

export const DonutChart = ({ data, size = 130, stroke = 14, vibrant = true }: {
  data: { label: string; value: number; color: string }[]; size?: number; stroke?: number; vibrant?: boolean;
}) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - stroke / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const seg = (
            <circle key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={d.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${C}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              opacity={vibrant ? 1 : 0.85}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)', fontFamily: FONT_MONO }}>SPENT</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: '-0.03em' }}>€{total.toFixed(0)}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>this month</span>
      </div>
    </div>
  );
};

// ── Bar chart ──────────────────────────────────────────────────────────────

export const BarChart = ({ data, accent, height = 80, budget }: {
  data: { label: string; value: number }[]; accent: string; height?: number; budget?: number;
}) => {
  const max = Math.max(...data.map((d) => d.value), budget || 0);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, position: 'relative' }}>
        {budget && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: `${100 - (budget / max) * 100}%`,
            borderTop: `1px dashed ${TOK.textFaint}`,
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <span style={{
              fontSize: 9, color: TOK.textFaint, fontFamily: FONT_MONO,
              transform: 'translateY(-10px)', background: TOK.surface, padding: '0 4px',
            }}>budget €{budget}</span>
          </div>
        )}
        {data.map((d, i) => {
          const h = (d.value / max) * 100;
          const isToday = i === data.length - 1;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', position: 'relative' }}>
              <div style={{
                width: '100%', height: `${h}%`, borderRadius: 5,
                background: isToday ? accent : (d.value > (budget || Infinity) ? TOK.scarlet : 'rgba(255,255,255,0.18)'),
                position: 'relative',
              }}>
                {isToday && (
                  <div style={{
                    position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 9, fontWeight: 700, color: accent, fontFamily: FONT_MONO,
                    whiteSpace: 'nowrap',
                  }}>€{d.value}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {data.map((d, i) => (
          <span key={i} style={{
            flex: 1, textAlign: 'center', fontSize: 9, fontFamily: FONT_MONO,
            color: i === data.length - 1 ? accent : TOK.textFaint,
            fontWeight: 700,
          }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
};
