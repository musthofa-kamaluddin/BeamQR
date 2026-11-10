# BeamQR

Transfer file & teks **tanpa internet, Wi-Fi, maupun Bluetooth**, murni melalui cahaya layar ke kamera (*air-gapped optical link*).

## Fitur Utama

- **Rute Terpisah & Offline-First PWA:**
  - `/` : Landing page dengan simulasi optik live (*Optical Pixel Instrument*).
  - `/send` : Pemancar QR dengan tombol **Start**, kontrol FPS, ukuran blok, dan preset kecepatan.
  - `/receive` : Pemindai kamera hybrid (`BarcodeDetector` + Web Worker `jsQR`), peta blok piksel real-time, serta verifikasi `SHA-256`.
- **Percepatan Transfer Optik (100% Tanpa Sinyal):**
  - **Multi-QR Grid (`2x1` / `2x2`):** Menampilkan 2 atau 4 QR independen dalam satu frame (`2x`-`4x` throughput).
  - **RGB Color-Multiplexed QR (`3x`):** Menumpuk 3 aliran QR ke channel Red, Green, dan Blue dengan versi matriks tersinkronisasi (`3x` per kotak, hingga **`12x` pada mode `2x2 RGB Turbo`**).
  - **Fountain Code (LT Robust Soliton) + GF(2) Solver:** Tahan frame buram/hilang tanpa perlu ulang dari awal, ditambah kompresi `Deflate-Raw` & encoding **Base45** (Alphanumeric QR) + `CRC-32`.

## Menjalankan Lokal

```bash
pnpm install
pnpm dev -- --host
```

> Dev server otomatis memakai HTTPS (`@vitejs/plugin-basic-ssl`) agar kamera HP bisa dibuka langsung melalui jaringan lokal (`https://<IP-laptop>:5173/`). Pada build produksi (`pnpm build`), plugin SSL dev tidak disertakan sehingga siap di-host di HTTPS resmi seperti Vercel.

## Pengujian & Build

```bash
pnpm test
pnpm build
```

## Deploy ke GitHub & Vercel

1. Push repositori ke GitHub (`https://github.com/musthofa-kamaluddin/BeamQR`).
2. Import repositori di Vercel. Konfigurasi di [vercel.json](file:///D:/Github/beamqr/vercel.json) sudah mengatur `buildCommand: "pnpm build"`, `outputDirectory: "dist"`, rewrite SPA (`/send` dan `/receive` ke `/index.html`), serta header cache `sw.js`.

## Lisensi

Proyek ini dirilis di bawah lisensi [MIT](LICENSE).
