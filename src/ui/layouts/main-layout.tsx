import { useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import { DropZone } from '../components/drop-zone';
import { LayerSelector } from '../components/layer-selector';
import { PropertyPicker } from '../components/property-picker';
import { RidershipPanel } from '../components/ridership-panel';
import { MapPreview } from '../components/map-preview';
import { LogPanel } from '../components/log-panel';
import { ProgressBar } from '../components/progress-bar';
import { downloadAll } from '../../lib/download';

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className={`section${open ? ' open' : ''}`}>
      <div className="section-header" onClick={() => setOpen(!open)}>{title}</div>
      <div className="section-body">{children}</div>
    </div>
  );
}

export function MainLayout() {
  const { t } = useT();
  const phase = useAppStore(s => s.phase);
  const language = useAppStore(s => s.language);
  const setLanguage = useAppStore(s => s.setLanguage);
  const summary = useAppStore(s => s.gtfsSummary);
  const validationResults = useAppStore(s => s.validationResults);
  const progress = useAppStore(s => s.progress);
  const generatedLayers = useAppStore(s => s.generatedLayers);
  const exportFormat = useAppStore(s => s.exportFormat);
  const is3D = useAppStore(s => s.is3D);
  const setIs3D = useAppStore(s => s.setIs3D);
  const generateLayers = useAppStore(s => s.generateLayers);
  const reset = useAppStore(s => s.reset);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);

  const selectedLayer = useAppStore(s => s.selectedLayer);
  const canGenerate = phase === 'loaded' || phase === 'done';
  const hasResults = Object.keys(generatedLayers).length > 0;

  return (
    <div className="app-layout">
      {!sidebarOpen && (
        <button className="sidebar-toggle sidebar-toggle-closed" onClick={() => setSidebarOpen(true)}>
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      )}
      <aside className={`sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1>gtfs-cooker</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="sidebar-toggle"
                onClick={() => setLanguage(language === 'en' ? 'ja' : 'en')}
                title={language === 'en' ? 'Japanese' : 'English'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>language</span>
                <span style={{ fontSize: 10, fontWeight: 500 }}>{language.toUpperCase()}</span>
              </button>
              <button
                className={`sidebar-toggle${is3D ? ' sidebar-toggle-active' : ''}`}
                onClick={() => setIs3D(!is3D)}
                title={is3D ? '2D' : '3D'}
              >
                <span style={{ fontSize: 11, fontWeight: 600 }}>{is3D ? '2D' : '3D'}</span>
              </button>
              <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)}>
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
            </div>
          </div>
          <p>GTFS ZIP → GeoJSON</p>
        </div>

        <div className="sidebar-content">
          <Section title={t('section.load')} defaultOpen>
            <DropZone />
            {progress && <ProgressBar value={progress.current} max={progress.total} label={progress.label} />}
          </Section>

          {summary && (
            <Section title={t('section.results')} defaultOpen>
              <dl className="summary">
                <dt>{t('summary.agency')}</dt><dd>{summary.agencyNames.join(', ') || '—'}</dd>
                <dt>{t('summary.routes')}</dt><dd>{summary.routeCount.toLocaleString()}</dd>
                <dt>{t('summary.stops')}</dt><dd>{summary.stopCount.toLocaleString()}</dd>
                <dt>{t('summary.trips')}</dt><dd>{summary.tripCount.toLocaleString()}</dd>
                <dt>shapes.txt:</dt><dd>{summary.hasShapes ? t('summary.yes') : t('summary.no')}</dd>
              </dl>
              {validationResults.length > 0 && (
                <div className="validation-list" style={{ marginTop: 8 }}>
                  {validationResults.map((v, i) => (
                    <div key={i} className={`validation-item ${v.level}`}>
                      [{v.level}] {v.message}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {(phase === 'loaded' || phase === 'generating' || phase === 'done') && (
            <>
              <Section title={t('section.layer')} defaultOpen>
                <LayerSelector />
                {selectedLayer === 'matching' && <RidershipPanel />}
              </Section>

              <Section title={t('section.properties')}>
                <PropertyPicker />
              </Section>
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <button
            className="btn btn-primary"
            disabled={!canGenerate}
            onClick={() => generateLayers()}
          >
            {phase === 'generating' ? t('btn.generating') : t('btn.generate')}
          </button>
          {hasResults && (
            <button
              className="btn btn-download btn-icon"
              onClick={() => downloadAll(generatedLayers, exportFormat)}
            >
              <span className="material-symbols-outlined">download</span>
            </button>
          )}
          <button className="btn btn-secondary btn-icon" onClick={() => reset()}>
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>

        <div className="privacy-notice">
          {t('privacy')}
          <br />
          {t('distributor.label')}: <a href="https://github.com/nagampere" target="_blank" rel="noopener noreferrer">nagampere</a> / <a href="https://amane.ltd/" target="_blank" rel="noopener noreferrer">{t('distributor.name')}</a>
        </div>
      </aside>

      <main className="main-area">
        <div className="map-container">
          <MapPreview />
        </div>
        <div className={`log-wrapper${logOpen ? ' open' : ''}`}>
          <div className="log-toggle" onClick={() => setLogOpen(!logOpen)}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {logOpen ? 'expand_more' : 'expand_less'}
            </span>
            <span>{t('log')}</span>
          </div>
          {logOpen && <LogPanel />}
        </div>
      </main>
    </div>
  );
}
