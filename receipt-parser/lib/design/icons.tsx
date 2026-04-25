import React from 'react';

// SVG icons — minimal line set used across the dashboard
type ColorFn = (c?: string) => React.ReactElement;

export const ICN: Record<string, ColorFn> = {
  home: (c = 'currentColor') => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
    </svg>
  ),
  message: (c = 'currentColor') => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v12H8l-4 4z" />
    </svg>
  ),
  insight: (c = 'currentColor') => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20h18" /><path d="M7 16v-6" /><path d="M12 16V6" /><path d="M17 16v-9" />
    </svg>
  ),
  card: (c = 'currentColor') => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 11h18" />
    </svg>
  ),
  user: (c = 'currentColor') => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  ),
  bell: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1112 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" /><path d="M10 21a2 2 0 004 0" />
    </svg>
  ),
  scan: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 012-2h2" /><path d="M21 7V5a2 2 0 00-2-2h-2" />
      <path d="M3 17v2a2 2 0 002 2h2" /><path d="M21 17v2a2 2 0 01-2 2h-2" />
      <path d="M7 12h10" />
    </svg>
  ),
  arrow: (c = 'currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
    </svg>
  ),
  receipt: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" />
    </svg>
  ),
  plus: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" /><path d="M5 12h14" />
    </svg>
  ),
  search: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
    </svg>
  ),
  check: (c = 'currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l5 5L20 6" />
    </svg>
  ),
  doubleCheck: (c = 'currentColor') => (
    <svg width="16" height="14" viewBox="0 0 24 16" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8l4 4 9-9" /><path d="M9 12l1 1 9-9" />
    </svg>
  ),
  clock: (c = 'currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  chevR: (c = 'currentColor') => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  chevL: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  sparkle: (c = 'currentColor') => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M19 16l.7 1.8L21 18.5l-1.3.7L19 21l-.7-1.8L17 18.5l1.3-.7z" />
    </svg>
  ),
};
