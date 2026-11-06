// addressbook.js — a personal, local directory of remote computers.
// Entries are keyed by the TEACHER machine's persistent identity fingerprint
// (see shared/identity.js), so once a session announces "this is machine
// fp:ab12cd34...", the matching nickname/group is found automatically —
// even though the connection itself is still set up with a manual code
// each time (no discovery server, per your choice).

const STORAGE_KEY = 'support-addressbook-v1';

function loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveAll(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function upsert(fingerprint, { nickname, group, notes }) {
  const all = loadAll();
  all[fingerprint] = {
    ...(all[fingerprint] || {}),
    nickname: nickname ?? all[fingerprint]?.nickname ?? '',
    group: group ?? all[fingerprint]?.group ?? 'ללא קבוצה',
    notes: notes ?? all[fingerprint]?.notes ?? '',
    lastSeen: new Date().toISOString()
  };
  saveAll(all);
  return all[fingerprint];
}

function get(fingerprint) {
  return loadAll()[fingerprint] || null;
}

function remove(fingerprint) {
  const all = loadAll();
  delete all[fingerprint];
  saveAll(all);
}

// Returns entries grouped by `group`, optionally filtered by a search term
// matching nickname, group name, or notes — this is the "find among dozens" lookup.
function search(term = '') {
  const all = loadAll();
  const t = term.trim().toLowerCase();
  const matches = Object.entries(all)
    .filter(([fp, e]) => !t ||
      e.nickname.toLowerCase().includes(t) ||
      e.group.toLowerCase().includes(t) ||
      e.notes.toLowerCase().includes(t) ||
      fp.includes(t))
    .map(([fingerprint, e]) => ({ fingerprint, ...e }));

  const grouped = {};
  for (const entry of matches) {
    (grouped[entry.group] ||= []).push(entry);
  }
  return grouped;
}

window.AddressBook = { upsert, get, remove, search, loadAll };
