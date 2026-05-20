import { useAppStore } from '../../store/app-store';
import { t, tf } from '../../i18n';

export function useT() {
  useAppStore(s => s.language);
  return { t, tf };
}
