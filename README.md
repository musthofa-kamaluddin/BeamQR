# BeamQR

Transfer file & teks **tanpa internet, Wi-Fi, maupun Bluetooth**, murni melalui cahaya layar ke kamera (*air-gapped optical link*).

## Fitur Utama

- **Rute Terpisah & Offline-First PWA:**
  - `/` : Landing page dengan simulasi optik live (*Optical Pixel Instrument*).
  - `/send` : Pemancar QR dengan tombol **Start**, kontrol FPS, ukuran blok, dan preset kecepatan.
  - `/receive` : Pemindai kamera hybrid (`BarcodeDetector` + Web Worker `jsQR`), peta blok piksel real-time, serta verifikasi `SHA-256`.
- **Efisiensi Transfer Optik (100% Tanpa Sinyal):**
  - **1x1 Hitam-Putih (BnW) Kontras Tinggi:** Fokus pada QR Code monokrom tunggal dengan margin bersih agar tetap cepat terbaca kamera ponsel tanpa distorsi warna maupun interferensi grid.
  - **Header V2 Ringkas (8 Byte) + CRC-16:** Overhead per paket data dipangkas menjadi `1B tag + 2B sessionId + 3B sequence + 2B CRC-16`, menyisakan lebih banyak ruang payload per frame QR.
  - **Kompresi Lossless `Deflate-Raw` Level-9 (`fflate`):** Mengecilkan file teks/dokumen/data berulang secara agresif sebelum transfer dan didekompresi 100% bit-exact di ponsel penerima (`SHA-256` terverifikasi).
  - **Fountain Code (LT Robust Soliton) + GF(2) Solver:** Tahan frame buram/hilang tanpa perlu ulang dari awal, dipadukan dengan encoding **Base45** (Alphanumeric QR).

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
