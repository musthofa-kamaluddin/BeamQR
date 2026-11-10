import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ProtocolInfoModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProtocolInfoModal({ open, onClose }: ProtocolInfoModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="protocol-dialog"
      aria-labelledby="protocol-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        // Light dismiss on backdrop click
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="dialog-inner">
        <div className="card-header" style={{ marginBlockEnd: 0 }}>
          <h2 id="protocol-dialog-title" className="card-title" style={{ fontSize: '1.125rem' }}>
            Cara Kerja Transfer Optik BeamQR
          </h2>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Tutup panduan protokol"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p style={{ color: 'var(--fg-secondary)', fontSize: '0.875rem' }}>
          BeamQR memindahkan data sepenuhnya lewat cahaya layar ke kamera tanpa Wi-Fi, Bluetooth,
          atau internet. Setelah dimuat sekali, aplikasi tetap berjalan offline melalui Service Worker.
        </p>

        <ol className="dialog-list">
          <li>
            <strong>Kompresi &amp; Hash:</strong> File dikompresi (<code>Deflate-Raw</code>) lalu
            dihitung hash <code>SHA-256</code> untuk verifikasi bit-per-bit di sisi penerima.
          </li>
          <li>
            <strong>Fountain (LT Code):</strong> File dipecah menjadi <em>K</em> blok. Pengirim
            memancarkan paket XOR acak (distribusi Robust Soliton) plus paket jangkar berkala.
            Penerima cukup menangkap blok mana saja hingga sistem persamaan linear GF(2) terpecahkan.
          </li>
          <li>
            <strong>Multi-QR Grid &amp; RGB 3-Channel:</strong> Untuk kecepatan tinggi tanpa
            internet, aktifkan grid <code>2x1 / 2x2</code> (hingga 4 QR per frame) atau mode warna{' '}
            <code>RGB</code> (3 QR berbeda di channel R, G, dan B secara bersamaan, hingga 12 paket
            per frame pada mode 2x2 RGB!).
          </li>
          <li>
            <strong>Tips Scan Optimal:</strong> Atur kecerahan layar pengirim ~75%, hindari pantulan
            lampu langsung, jarak kamera 20-35 cm. Mulai dari <strong>1x Standar</strong> bila
            cahaya redup, lalu naikkan ke <strong>Quad / RGB / Turbo</strong> di layar terang.
          </li>
        </ol>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Mengerti
          </button>
        </div>
      </div>
    </dialog>
  );
}
