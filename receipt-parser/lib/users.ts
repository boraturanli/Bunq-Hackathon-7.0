export interface MockUser {
  id: string;          // URL-safe slug derived from email
  name: string;
  email: string;       // canonical identifier (or IBAN for top friends)
  color: string;       // avatar background
  source?: 'top-friend' | 'custom';
}

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#FFD93D', '#A8DADC',
  '#B388EB', '#F4845F', '#9DCD5A', '#5DB7DE',
];

/** Stable colour assignment from any string key. */
export function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

/** Lower-case + strip everything except [a-z0-9]. */
export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

declare global {
  // eslint-disable-next-line no-var
  var __snapsplitUsers: Map<string, MockUser> | undefined;
}

const registry: Map<string, MockUser> =
  globalThis.__snapsplitUsers ?? (globalThis.__snapsplitUsers = new Map());

export function registerUser(input: {
  name: string;
  email: string;
  color?: string;
  source?: 'top-friend' | 'custom';
}): MockUser {
  const id = slugify(input.email);
  const existing = registry.get(id);
  if (existing) {
    // Update name/color if richer info arrived (e.g. top-friend overrides earlier custom)
    if (input.name && input.name !== existing.name) existing.name = input.name;
    if (input.color) existing.color = input.color;
    if (input.source) existing.source = input.source;
    return existing;
  }
  const user: MockUser = {
    id,
    name: input.name || input.email,
    email: input.email,
    color: input.color ?? colorFor(id),
    source: input.source,
  };
  registry.set(id, user);
  return user;
}

export function getUserById(id: string): MockUser | undefined {
  return registry.get(id);
}

export function listUsers(): MockUser[] {
  return Array.from(registry.values());
}

/** For unregistered IDs, derive a placeholder so /inbox/<anyslug> always works. */
export function placeholderUser(id: string): MockUser {
  return {
    id,
    name: id.split('-').map((s) => s[0]?.toUpperCase() + s.slice(1)).join(' ') || id,
    email: id,
    color: colorFor(id),
  };
}
