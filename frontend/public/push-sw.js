/**
 * GramSathi Service Worker Web Push & Notification Handler
 *
 * Handles incoming push events from the browser Push Service and handles
 * notification clicks with safe window focusing and open-redirect protection.
 */

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('[SW Push] Push event received with empty payload.');
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch (err) {
    payload = {
      title: 'GramSathi Health Alert',
      body: event.data.text()
    };
  }

  // An SOS asks to stay on screen until someone acts on it; everything else
  // keeps the previous, dismissible behaviour.
  const urgent = Boolean(payload.requireInteraction);

  const title = payload.title || 'GramSathi Health Alert';
  const options = {
    body: payload.body || 'You have an update in GramSathi.',
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/logo.png',
    tag: payload.tag || `gramsathi-notification-${Date.now()}`,
    data: payload.data || { url: '/' },
    vibrate: urgent ? [300, 100, 300, 100, 300] : [100, 50, 100],
    renotify: true,
    requireInteraction: urgent
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let rawUrl = event.notification.data?.url || '/';
  if (rawUrl.startsWith('/') && !rawUrl.startsWith('/#') && rawUrl !== '/') {
    rawUrl = '/#' + rawUrl;
  }

  // Guard against open redirect attacks: resolve strictly against self.location.origin
  let targetUrl;
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) {
      targetUrl = parsed.href;
    } else {
      targetUrl = self.location.origin + '/';
    }
  } catch (err) {
    targetUrl = self.location.origin + '/';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a GramSathi tab/window is already open, focus it and navigate
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus().then((focused) => {
            const target = focused || client;
            if (!('navigate' in target)) return target;
            // navigate() rejects for a window this worker does not control;
            // opening the page is better than a click that does nothing.
            return target.navigate(targetUrl).catch(() => clients.openWindow && clients.openWindow(targetUrl));
          });
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
