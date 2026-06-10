import crypto from 'crypto';
import { isProd, tokenEncryptionKey } from './config';

// Szyfrowanie tokenów Stravy przed zapisem do bazy (AES-256-GCM).
// Klucz bierzemy z TOKEN_ENCRYPTION_KEY i normalizujemy przez SHA-256, więc
// sekret może mieć dowolną długość/format (hex, base64, fraza).
//
// Format zapisu:  v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
// Wartości BEZ prefiksu 'v1:' traktujemy jako stary, niezaszyfrowany token
// (wsteczna kompatybilność) — przy pierwszym odświeżeniu zostaną nadpisane
// wersją zaszyfrowaną.

const PREFIX = 'v1';

function key(): Buffer | null {
  if (!tokenEncryptionKey) return null;
  return crypto.createHash('sha256').update(tokenEncryptionKey).digest();
}

/** Szyfruje token przed zapisem. Bez klucza: w produkcji błąd, lokalnie plaintext. */
export function encryptToken(plain: string): string {
  const k = key();
  if (!k) {
    if (isProd) {
      throw new Error(
        'Brak TOKEN_ENCRYPTION_KEY — w produkcji tokeny muszą być szyfrowane. Ustaw zmienną środowiskową.',
      );
    }
    return plain; // wygoda lokalna
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Odszyfrowuje token z bazy. Stare plaintext-tokeny zwraca bez zmian. */
export function decryptToken(stored: string): string {
  if (!stored.startsWith(`${PREFIX}:`)) return stored; // legacy plaintext
  const k = key();
  if (!k) {
    throw new Error('Token jest zaszyfrowany, ale brak TOKEN_ENCRYPTION_KEY do odszyfrowania.');
  }
  const [, ivB64, tagB64, ctB64] = stored.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
