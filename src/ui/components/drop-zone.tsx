import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';

export function DropZone() {
  const { t } = useT();
  const loadGtfsFile = useAppStore(s => s.loadGtfsFile);
  const loadGtfsUrl = useAppStore(s => s.loadGtfsUrl);
  const phase = useAppStore(s => s.phase);
  const [dragover, setDragover] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (file.name.endsWith('.zip') || file.type === 'application/zip') {
      loadGtfsFile(file);
    }
  }, [loadGtfsFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleUrlSubmit = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    loadGtfsUrl(trimmed);
  }, [url, loadGtfsUrl]);

  const disabled = phase === 'loading' || phase === 'generating';

  return (
    <div>
      <div
        className={`drop-zone${dragover ? ' dragover' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div>{t('drop.drag')}</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>{t('drop.click')}</div>
      </div>

      <div className="url-input-group" style={{ marginTop: 10 }}>
        <input
          type="text"
          className="url-input"
          placeholder="https://example.com/gtfs.zip"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleUrlSubmit(); }}
          disabled={disabled}
        />
        <button
          className="btn btn-primary url-input-btn"
          onClick={handleUrlSubmit}
          disabled={disabled || !url.trim()}
        >
          {t('drop.load')}
        </button>
      </div>
    </div>
  );
}
