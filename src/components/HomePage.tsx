import { ArrowRight, Camera, Cpu, Layers, QrCode, ShieldCheck, Zap } from 'lucide-react';
import type { AppRoute } from '../hooks/useRouter';
import { OpticalBeamDemo } from './OpticalBeamDemo';

interface HomePageProps {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  themeKey: 'light' | 'dark';
  onLinkClick: (to: AppRoute) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function HomePage({ headingRef, themeKey, onLinkClick }: HomePageProps) {
  return (
    <div className="page-enter stack" style={{ gap: 28 }}>
      {/* Hero Asymmetric Bento */}
      <section className="hero-grid" aria-labelledby="hero-heading">
        <div className="stack" style={{ gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="pixel-badge" data-tone="mint">
              AIR-GAPPED OPTICAL LINK
            </span>
            <span className="pixel-badge" data-tone="amber">
              NO INTERNET • NO WIFI
            </span>
          </div>

          <h1 id="hero-heading" ref={headingRef} tabIndex={-1} className="hero-title">
            Pindahkan file lewat <span className="hero-highlight">cahaya piksel</span>, tanpa
            jaringan.
          </h1>

          <p className="hero-lead">
            BeamQR mengubah file atau teks menjadi aliran QR Code berkecepatan tinggi dengan{' '}
            <strong>Fountain (LT Code)</strong> dan <strong>Base45</strong>. Cukup buka di dua
            browser, arahkan kamera, dan biarkan blok data tersusun otomatis.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 4 }}>
            <a
              href="/send"
              onClick={onLinkClick('/send')}
              className="btn btn-primary btn-lg pixel-action"
              style={{ textDecoration: 'none' }}
            >
              <QrCode size={18} aria-hidden="true" />
              Buka Pengirim (/send)
              <ArrowRight size={16} aria-hidden="true" />
            </a>

            <a
              href="/receive"
              onClick={onLinkClick('/receive')}
              className="btn btn-lg pixel-action"
              style={{ textDecoration: 'none' }}
            >
              <Camera size={18} aria-hidden="true" />
              Buka Penerima (/receive)
            </a>
          </div>

          <div className="spec-strip mono">
            <span>2×2 QUAD GRID (4×)</span>
            <span aria-hidden="true">•</span>
            <span>RGB COLOR QR (3×)</span>
            <span aria-hidden="true">•</span>
            <span>LT FOUNTAIN + GF(2)</span>
            <span aria-hidden="true">•</span>
            <span>OFFLINE PWA</span>
          </div>
        </div>

        <OpticalBeamDemo themeKey={themeKey} />
      </section>

      {/* Pipeline Telemetry Strip (Asymmetric 3-Stage Sequence) */}
      <section aria-labelledby="pipeline-heading" className="stack" style={{ gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 id="pipeline-heading" className="section-title">
            Arsitektur Transfer Optik
          </h2>
          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--fg-secondary)' }}>
            3-STAGE FOUNTAIN PIPELINE
          </span>
        </div>

        <div className="pipeline-grid">
          <article className="pixel-card stage-card" data-accent="amber">
            <div className="stage-top">
              <span className="pixel-step">01</span>
              <Layers size={18} aria-hidden="true" style={{ color: 'var(--amber)' }} />
            </div>
            <h3 className="card-title">Kompres &amp; Fountain XOR</h3>
            <p className="card-meta">
              File dikompresi via Deflate lalu dipecah jadi blok <em>K</em> dengan distribusi
              Robust Soliton. Frame yang terlewat kamera tidak memaksa kirim ulang dari awal.
            </p>
          </article>

          <article className="pixel-card stage-card" data-accent="sky">
            <div className="stage-top">
              <span className="pixel-step">02</span>
              <Zap size={18} aria-hidden="true" style={{ color: 'var(--sky)' }} />
            </div>
            <h3 className="card-title">Base45 Pixel Beam</h3>
            <p className="card-meta">
              Setiap frame dipacking ke alfabet Base45 Alphanumeric (~25% lebih ringkas di QR
              dibanding Base64) dan dilindungi CRC-32 sebelum diproyeksikan ke layar.
            </p>
          </article>

          <article className="pixel-card stage-card" data-accent="mint">
            <div className="stage-top">
              <span className="pixel-step">03</span>
              <ShieldCheck size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
            </div>
            <h3 className="card-title">Peeling &amp; Verifikasi</h3>
            <p className="card-meta">
              Penerima menggabungkan <code>BarcodeDetector</code> + Worker <code>jsQR</code>,
              menyelesaikan blok via eliminasi Gauss GF(2), lalu memvalidasi bit akhir dengan
              SHA-256.
            </p>
          </article>
        </div>
      </section>

      {/* Dedicated Workspace Entry Cards */}
      <section aria-labelledby="routes-heading" className="routes-grid">
        <h2 id="routes-heading" className="visually-hidden">
          Pilih Halaman Pengirim atau Penerima
        </h2>

        <a
          href="/send"
          onClick={onLinkClick('/send')}
          className="pixel-card route-card"
          data-tone="mint"
        >
          <div className="route-card-head">
            <span className="pixel-badge" data-tone="mint">
              /SEND
            </span>
            <ArrowRight size={18} aria-hidden="true" className="route-arrow" />
          </div>
          <h3 className="route-title">Halaman Pengirim</h3>
          <p className="card-meta">
            Pilih file atau ketik catatan, atur FPS dan ukuran blok, lalu tekan <strong>Start</strong>{' '}
            untuk memancarkan aliran QR berkecepatan stabil.
          </p>
          <div className="route-meta mono">
            <span>• Mode LT &amp; Cyclic</span>
            <span>• Layar Penuh</span>
            <span>• Wake Lock</span>
          </div>
        </a>

        <a
          href="/receive"
          onClick={onLinkClick('/receive')}
          className="pixel-card route-card"
          data-tone="sky"
        >
          <div className="route-card-head">
            <span className="pixel-badge" data-tone="sky">
              /RECEIVE
            </span>
            <ArrowRight size={18} aria-hidden="true" className="route-arrow" />
          </div>
          <h3 className="route-title">Halaman Penerima</h3>
          <p className="card-meta">
            Buka kamera belakang atau webcam, lihat peta blok piksel menyala real-time, lalu unduh
            file setelah hash SHA-256 terkonfirmasi cocok.
          </p>
          <div className="route-meta mono">
            <span>• Hybrid Decoder</span>
            <span>• Peta Blok Live</span>
            <span>• Senter &amp; Multi-Kamera</span>
          </div>
        </a>

        <div className="pixel-card route-info-cell">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={16} aria-hidden="true" style={{ color: 'var(--amber)' }} />
            <strong style={{ fontSize: '0.875rem' }}>100% Di Perangkat</strong>
          </div>
          <p className="card-meta">
            Semua aset, worker decoder, dan font ter-cache lokal oleh Service Worker. Tidak ada
            server backend maupun unggahan cloud.
          </p>
        </div>
      </section>
    </div>
  );
}
