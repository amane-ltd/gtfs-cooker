import { useState, type FormEvent, type ReactNode } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import { PW_HASH, verifyPassword, InsecureContextError } from '../../auth/password';
import { isAuthorized, saveAuthorization } from '../../auth/session';

/** 問い合わせ先メールアドレス。 */
const CONTACT_EMAIL = 'info@amane.ltd';

/** パスワードによる簡易アクセスゲート。VITE_ACCESS_PW_HASH 未設定時は開発サーバーでのみ素通しする。 */
export function LoginGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  const language = useAppStore(s => s.language);
  const setLanguage = useAppStore(s => s.setLanguage);
  const [authorized, setAuthorized] = useState(() => isAuthorized());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (authorized || (!PW_HASH && import.meta.env.DEV)) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      if (await verifyPassword(password)) {
        saveAuthorization();
        setAuthorized(true);
      } else {
        setError(t('login.error'));
        setPassword('');
      }
    } catch (err) {
      setError(err instanceof InsecureContextError ? t('login.insecureContext') : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="login-gate">
      <div className="login-card">
        <div className="login-header">
          <h1>GTFS-cooker</h1>
          <button
            className="sidebar-toggle"
            onClick={() => setLanguage(language === 'en' ? 'ja' : 'en')}
            title={language === 'en' ? 'Japanese' : 'English'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>language</span>
            <span style={{ fontSize: 10, fontWeight: 500 }}>{language.toUpperCase()}</span>
          </button>
        </div>

        {PW_HASH ? (
          <form onSubmit={handleSubmit}>
            <p className="login-prompt">{t('login.prompt')}</p>
            <div className="field">
              <label className="field-label" htmlFor="access-password">{t('login.password')}</label>
              <input
                id="access-password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button className="btn btn-primary login-submit" type="submit" disabled={checking || !password}>
              {checking ? t('login.checking') : t('login.submit')}
            </button>
          </form>
        ) : (
          <p className="login-error">{t('login.notConfigured')}</p>
        )}

        <p className="login-contact">
          {t('login.contact')}
          <br />
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>

        <div className="login-footer">
          <a href="https://amane.ltd/" target="_blank" rel="noopener noreferrer">{t('distributor.name')}</a>
        </div>
      </div>
    </div>
  );
}
