import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Moon, QrCode, ScanLine, Send, Sun, WifiOff } from 'lucide-react';
import { HomePage } from './components/HomePage';
import { ProtocolInfoModal } from './components/ProtocolInfoModal';
import { ReceiverPanel } from './components/ReceiverPanel';
import { SenderPanel } from './components/SenderPanel';
import { useRouter } from './hooks/useRouter';

type ThemeOverride = 'system' | 'light' | 'dark';

export function App() {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const { route, onLinkClick } = useRouter(headingRef);

  const [infoOpen, setInfoOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  );
  const [theme, setTheme] = useState<ThemeOverride>('system');

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const resolvedThemeKey: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  const toggleTheme = () => {
    setTheme(resolvedThemeKey === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link visually-hidden">
        Lewati ke konten utama
      </a>

      <header className="site-header">
        <div className="pixel-top-strip" aria-hidden="true" />
        <div className="container header-inner">
          <a
            href="/"
            onClick={onLinkClick('/')}
            className="brand-link"
            aria-label="BeamQR Beranda"
          >
            <div className="brand-mark" aria-hidden="true">
              <QrCode size={18} />
            </div>
            <div className="brand-text">
              <span className="brand-title">BeamQR</span>
              <span className="brand-subtitle">OPTICAL PIXEL TRANSFER</span>
            </div>
          </a>

          <nav className="site-nav" aria-label="Primary">
            <ul className="nav-list">
              <li>
                <a
                  href="/"
                  onClick={onLinkClick('/')}
                  className="nav-link"
                  aria-current={route === '/' ? 'page' : undefined}
                >
                  Beranda
                </a>
              </li>
              <li>
                <a
                  href="/send"
                  onClick={onLinkClick('/send')}
                  className="nav-link"
                  aria-current={route === '/send' ? 'page' : undefined}
                >
                  <Send size={14} aria-hidden="true" />
                  Kirim
                </a>
              </li>
              <li>
                <a
                  href="/receive"
                  onClick={onLinkClick('/receive')}
                  className="nav-link"
                  aria-current={route === '/receive' ? 'page' : undefined}
                >
                  <ScanLine size={14} aria-hidden="true" />
                  Terima
                </a>
              </li>
            </ul>
          </nav>

          <div className="header-actions">
            <span className="status-pill" data-tone={isOffline ? 'accent' : 'mint'}>
              <WifiOff size={13} aria-hidden="true" />
              <span className="hide-xs">{isOffline ? 'Offline Aktif' : 'Air-Gapped'}</span>
            </span>

            <button
              type="button"
              className="btn btn-icon"
              aria-label={
                resolvedThemeKey === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'
              }
              onClick={toggleTheme}
            >
              {resolvedThemeKey === 'dark' ? (
                <Sun size={16} aria-hidden="true" />
              ) : (
                <Moon size={16} aria-hidden="true" />
              )}
            </button>

            <button type="button" className="btn btn-sm" onClick={() => setInfoOpen(true)}>
              <HelpCircle size={15} aria-hidden="true" />
              <span className="hide-xs">Protokol</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="main-content">
        <div className="container">
          {route === '/' && (
            <HomePage
              headingRef={headingRef}
              themeKey={resolvedThemeKey}
              onLinkClick={onLinkClick}
            />
          )}
          {route === '/send' && <SenderPanel isActive={true} headingRef={headingRef} />}
          {route === '/receive' && (
            <ReceiverPanel isActive={true} themeKey={resolvedThemeKey} headingRef={headingRef} />
          )}
        </div>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <span>BeamQR • Optical Fountain (LT) + Base45 + Deflate + SHA-256</span>
          <span className="mono">100% Client-Side • Zero Network</span>
        </div>
      </footer>

      <ProtocolInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}

export default App;
