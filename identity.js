// identity.js — persistent cryptographic identity, shared logic for both
// the teacher agent (Electron renderer) and the supporter page (browser).
// Both environments expose window.crypto.subtle, so this file works in both.
//
// Replaces the earlier placeholder (a random UUID with no real security
// guarantee) with a real ECDSA P-256 key pair used to sign/verify challenges,
// so a connecting peer can prove it holds the private key instead of just
// claiming an id.

const DB_NAME = 'support-identity';
const STORE_NAME = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Loads the existing identity or creates one on first run. The key pair never
// leaves this origin/machine — only the public key and signatures travel
// over the DataChannel.
async function getOrCreateIdentity() {
  let stored = await idbGet('identity');
  if (stored) return stored;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const fingerprint = await fingerprintOf(publicKeyJwk);

  stored = { publicKeyJwk, privateKeyJwk, fingerprint };
  await idbSet('identity', stored);
  return stored;
}

// Short, human-shareable fingerprint of a public key (SHA-256, first 8 bytes, hex).
async function fingerprintOf(publicKeyJwk) {
  const data = new TextEncoder().encode(JSON.stringify(publicKeyJwk));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function importPrivateKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

async function signChallenge(privateKeyJwk, challengeBase64) {
  const key = await importPrivateKey(privateKeyJwk);
  const data = Uint8Array.from(atob(challengeBase64), c => c.charCodeAt(0));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyChallenge(publicKeyJwk, challengeBase64, signatureBase64) {
  const key = await importPublicKey(publicKeyJwk);
  const data = Uint8Array.from(atob(challengeBase64), c => c.charCodeAt(0));
  const sig = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
}

function randomChallenge() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes));
}

window.Identity = { getOrCreateIdentity, fingerprintOf, signChallenge, verifyChallenge, randomChallenge };
