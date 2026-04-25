// Design tokens for SnapSplit hi-fi (dark fintech aesthetic)
// Original — not a recreation of bunq's actual UI.

export const TOK = {
  bg:        '#000000',
  surface:   '#0E0E10',
  surface2:  '#17171A',
  border:    'rgba(255,255,255,0.08)',
  borderHi:  'rgba(255,255,255,0.16)',
  text:      '#FFFFFF',
  textDim:   'rgba(255,255,255,0.55)',
  textFaint: 'rgba(255,255,255,0.35)',

  // tile palette
  plum:    '#8B5CF6',
  amber:   '#F59E0B',
  teal:    '#14B8A6',
  rose:    '#EC4899',
  ocean:   '#3B82F6',
  lime:    '#84CC16',
  scarlet: '#EF4444',
  mint:    '#10B981',
  violet:  '#7C3AED',

  // signature accent — electric lime
  accent:    '#C8FF3D',
  accentInk: '#0A0A0A',
} as const;

export const FONT_DISPLAY = '"Bricolage Grotesque", "Inter", system-ui, sans-serif';
export const FONT_BODY    = '"Inter", system-ui, sans-serif';
export const FONT_MONO    = '"JetBrains Mono", ui-monospace, monospace';
