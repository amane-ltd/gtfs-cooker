import { PW_HASH } from './password';

const SESSION_KEY = 'gtfs-cooker-access';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

type Session = { expiresAt: number; hash: string };

export function isAuthorized(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { expiresAt, hash } = JSON.parse(raw) as Partial<Session>;
    if (typeof expiresAt !== 'number' || Date.now() > expiresAt) return clearAuthorization(), false;
    // パスワードを変更したら既存セッションを失効させる
    if (hash !== PW_HASH) return clearAuthorization(), false;
    return true;
  } catch {
    return false;
  }
}

export function saveAuthorization(): void {
  const session: Session = { expiresAt: Date.now() + TTL_MS, hash: PW_HASH };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}

export function clearAuthorization(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
