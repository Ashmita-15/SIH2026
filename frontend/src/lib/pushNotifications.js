import api from '../services/api.js';

/**
 * Utility to convert URL-safe base64 string to Uint8Array for PushManager
 */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Checks whether Web Push and Service Worker are supported by current browser/OS.
 */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Returns current notification permission: 'granted', 'denied', 'default', or 'unsupported'.
 */
export function getPushPermissionStatus() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Retrieves the active PushSubscription on this device, if one exists.
 */
export async function getCurrentPushSubscription() {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.debug('[Push] Could not retrieve existing subscription:', err);
    return null;
  }
}

/**
 * Subscribes the current device to Web Push notifications.
 * Prompts user for permission if not yet granted.
 *
 * @returns {Promise<{success: boolean, subscription?: PushSubscription, reason?: string, error?: string}>}
 */
export async function subscribeToPush() {
  if (!isPushSupported()) {
    return { success: false, reason: 'unsupported', error: 'Web Push is not supported in this browser' };
  }

  try {
    // 1. Request permission if not already decided
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return { success: false, reason: 'permission_denied', error: 'Notification permission was not granted' };
    }

    // 2. Fetch VAPID public key from backend
    const { data: keyData } = await api.get('/notifications/push/public-key');
    if (!keyData?.publicKey) {
      return { success: false, reason: 'missing_key', error: 'Server did not return a valid VAPID public key' };
    }

    const convertedVapidKey = urlBase64ToUint8Array(keyData.publicKey);

    // 3. Register subscription with browser Push Service
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }

    // 4. Send subscription endpoint & encryption keys to GramSathi backend
    const subJson = subscription.toJSON();
    await api.post('/notifications/push/subscribe', {
      endpoint: subJson.endpoint,
      keys: subJson.keys
    });

    console.log('[Push] Device successfully subscribed to GramSathi push notifications.');
    window.dispatchEvent(new CustomEvent('gramsathi:push-status-changed', { detail: { subscribed: true } }));

    return { success: true, subscription };
  } catch (err) {
    console.error('[Push] Subscription failed:', err);
    return { success: false, reason: 'subscription_error', error: err.message || 'Failed to subscribe' };
  }
}

/**
 * Unsubscribes current device from Web Push notifications.
 */
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { success: false, reason: 'unsupported' };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Notify backend to remove subscription record
      try {
        await api.post('/notifications/push/unsubscribe', { endpoint: subscription.endpoint });
      } catch (backendErr) {
        console.warn('[Push] Backend unsubscribe warning:', backendErr.message);
      }

      // Unsubscribe locally
      await subscription.unsubscribe();
    }

    window.dispatchEvent(new CustomEvent('gramsathi:push-status-changed', { detail: { subscribed: false } }));
    console.log('[Push] Device successfully unsubscribed.');
    return { success: true };
  } catch (err) {
    console.error('[Push] Unsubscribe error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Triggers a test push notification to this user's account for validation.
 */
export async function sendTestNotification() {
  try {
    const { data } = await api.post('/notifications/push/test');
    return data;
  } catch (err) {
    console.error('[Push] Test push error:', err);
    throw err;
  }
}

/**
 * Cleans up subscription on user logout to prevent subsequent device users from receiving notifications.
 */
export async function handleLogoutPushCleanup() {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription?.endpoint) {
      await api.post('/notifications/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
    }
  } catch (err) {
    console.debug('[Push] Logout cleanup skipped:', err.message);
  }
}

export default {
  urlBase64ToUint8Array,
  isPushSupported,
  getPushPermissionStatus,
  getCurrentPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestNotification,
  handleLogoutPushCleanup
};
