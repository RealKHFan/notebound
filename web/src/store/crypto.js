// Locked notes: AES-256-GCM with a key derived from the vault password
// (PBKDF2-SHA256). Every locked note carries its own salt, iteration count and
// IV, so it can be decrypted from the note file alone.

export const KDF_ITERATIONS = 310000;
const CHECK_TEXT = 'notebound-vault-check';
// Vaults made by the first test builds (named Pocketbook) hold this text instead.
const LEGACY_CHECK_TEXT = 'pocketbook-vault-check';
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

const keyCache = new Map();

export async function deriveKey(password, saltB64, iterations = KDF_ITERATIONS) {
  const cacheKey = `${saltB64}:${iterations}:${password}`;
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache.set(cacheKey, key);
  return key;
}

export function forgetKeys() {
  keyCache.clear();
}

export function randomB64(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toB64(b);
}

export async function encryptText(key, text) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

export async function decryptText(key, { iv, data }) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data));
  return dec.decode(plain);
}

/** Create the vault descriptor stored in notebound.json (no secret in it). */
export async function createVault(password) {
  const salt = randomB64(16);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const check = await encryptText(key, CHECK_TEXT);
  return { salt, iter: KDF_ITERATIONS, check };
}

/** Returns true when the password opens this vault descriptor. */
export async function verifyVault(password, vault) {
  if (!vault) return false;
  try {
    const key = await deriveKey(password, vault.salt, vault.iter);
    const text = await decryptText(key, vault.check);
    return text === CHECK_TEXT || text === LEGACY_CHECK_TEXT;
  } catch {
    return false;
  }
}

/** Encrypt a note body; result goes into meta.locked. */
export async function lockPayload(password, vault, payload) {
  const key = await deriveKey(password, vault.salt, vault.iter);
  const { iv, data } = await encryptText(key, JSON.stringify(payload));
  return { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: vault.iter, salt: vault.salt, iv, data };
}

export async function unlockPayload(password, locked) {
  const key = await deriveKey(password, locked.salt, locked.iter);
  return JSON.parse(await decryptText(key, locked));
}
