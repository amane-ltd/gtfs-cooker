import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';

export function LogPanel() {
  const { t } = useT();
  const logs = useAppStore(s => s.logs);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="log-panel" ref={ref}>
      {logs.length === 0 && (
        <div className="log-entry info">
          <span className="log-time">--:--:--</span>
          {t('log.empty')}
        </div>
      )}
      {logs.map((log, i) => {
        const time = new Date(log.timestamp);
        const ts = time.toLocaleTimeString('en-GB', { hour12: false });
        return (
          <div key={i} className={`log-entry ${log.level}`}>
            <span className="log-time">{ts}</span>
            {log.message}
          </div>
        );
      })}
    </div>
  );
}
