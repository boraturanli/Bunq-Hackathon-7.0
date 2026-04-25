export interface MockUser {
  id: string;
  name: string;
  email: string;
  color: string;
}

export const MOCK_USERS: MockUser[] = [
  { id: "alice", name: "Alice", email: "alice@bunq.com", color: "#FF6B6B" },
  { id: "bob",   name: "Bob",   email: "bob@bunq.com",   color: "#4ECDC4" },
  { id: "carol", name: "Carol", email: "carol@bunq.com", color: "#FFD93D" },
  { id: "dave",  name: "Dave",  email: "dave@bunq.com",  color: "#A8DADC" },
];

export function getUserById(id: string): MockUser | undefined {
  return MOCK_USERS.find((u) => u.id === id);
}
