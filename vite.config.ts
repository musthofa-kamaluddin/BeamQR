import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === 'serve' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'maskable-icon.svg'],
      manifest: {
        name: 'BeamQR - Optical Pixel File Transfer',
        short_name: 'BeamQR',
        description:
          'Transfer files offline with zero network using animated Fountain-coded pixel QR streams.',
        theme_color: '#0a0f14',
        background_color: '#0a0f14',
        display: 'standalone',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'maskable-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,woff,wasm}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/assets\//],
      },
    }),
  ],
  optimizeDeps: {
    include: ['jsqr', 'qrcode'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
  },
}));
