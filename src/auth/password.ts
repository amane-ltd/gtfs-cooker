// アクセスゲートのパスワード検証。
//
// 静的ホスティング上のクライアントサイド判定なので、暗号学的なアクセス制御にはならない。
// バンドルを取得すれば判定は迂回できるため、あくまで「関係者以外がうっかり触らない」ための抑止。
// 将来 HubSpot 連携に差し替える場合は verifyPassword() の中身だけを置き換えればよい。
//
// パラメータは scripts/hash-password.mjs と一致させること（片方だけ変えると検証が通らなくなる）。
const SALT = 'gtfs-cooker/access-gate/v1';
const ITERATIONS = 310_000;
const KEY_BYTES = 32;

/** ビルド時に注入される PBKDF2 ハッシュ（hex）。未設定なら空文字。 */
export const PW_HASH: string = (import.meta.env.VITE_ACCESS_PW_HASH ?? '').trim().toLowerCase();

export class InsecureContextError extends Error {}

export async function derivePasswordHash(password: string): Promise<string> {
  // crypto.subtle は secure context (https / localhost) でのみ利用できる
  if (!globalThis.crypto?.subtle) throw new InsecureContextError('Web Crypto API is unavailable');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8,
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!PW_HASH) return false;
  return (await derivePasswordHash(password)) === PW_HASH;
}
