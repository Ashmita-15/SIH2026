import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'logo.png', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png'],
      manifest: {
        name: 'GramSathi',
        short_name: 'GramSathi',
        description: 'GramSathi connects rural communities to doctors, health records and nearby pharmacies on low-bandwidth connections.',
        theme_color: '#0B5F63',
        background_color: '#F9FBFB',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            /*
             * Doctor lists change whenever a doctor opens or retires a session.
             * Under stale-while-revalidate the cached list was always shown first,
             * so a doctor who had just become bookable stayed missing until a
             * later visit. Network first keeps it current online and still falls
             * back to the last list offline.
             */
            urlPattern: ({ url }) =>
              url.pathname === '/api/users/doctors' || url.pathname === '/api/users/doctors/specialization',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gramsathi-doctors-cache',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 7
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: ({ url }) => {
              const pathname = url.pathname
              return (
                pathname.startsWith('/api/facilities') ||
                pathname.startsWith('/api/facility/tree') ||
                pathname.startsWith('/api/facility/meta') ||
                pathname === '/api/health-worker/danger-rules' ||
                pathname === '/api/pharmacy/all' ||
                pathname === '/api/assistant/config'
              )
            },
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gramsathi-public-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    host: true
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      stream: 'stream-browserify',
      buffer: 'buffer',
      process: 'process/browser',
      util: 'util'
    }
  },
  optimizeDeps: {
    include: [
      'simple-peer',
      'buffer',
      'process',
      'stream-browserify'
    ]
  },
  build: {
    commonjsOptions: {
      include: [/simple-peer/, /node_modules/]
    }
  }
})


