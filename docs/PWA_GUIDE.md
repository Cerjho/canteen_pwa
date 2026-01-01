# Progressive Web App Guide

## Overview

This app is a fully-featured PWA with offline support, installability, and push notifications.

---

## Features

### 1. **Installability**

Users can install the app to their home screen:

- **Android**: "Add to Home Screen" prompt
- **iOS**: Share → Add to Home Screen
- **Desktop**: Install button in browser address bar

### 2. **Offline Support**

- Menu cached for offline browsing
- Orders queued when offline
- Automatic sync when online

### 3. **Push Notifications**

- Order status updates
- Low balance alerts
- Promotional messages

### 4. **Background Sync**

- Queued orders sent in background
- Retry failed requests automatically

---

## PWA Configuration

### Manifest (`src/pwa/manifest.webmanifest`)

```json
{
  "name": "School Canteen",
  "short_name": "Canteen",
  "description": "Order food for your kids",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4F46E5",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**Key Properties**:

- `display: standalone` - Hides browser UI
- `theme_color` - Status bar color on Android
- `purpose: maskable` - Adaptive icons for Android

---

## Service Worker

### Caching Strategy

```typescript
// Cache-first for static assets
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })
    ]
  })
);

// Network-first for API calls
registerRoute(
  ({ url }) => url.origin === 'https://your-project.supabase.co',
  new NetworkFirst({
    cacheName: 'api',
    networkTimeoutSeconds: 5
  })
);
```

### Background Sync

Queues orders when offline:

```typescript
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncQueuedOrders());
  }
});
```

---

## Push Notifications

### Setup

1. Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

1. Add public key to `.env`:

```text
VITE_VAPID_PUBLIC_KEY=BM...
```

1. Request permission in app:

```typescript
const permission = await Notification.requestPermission();
if (permission === 'granted') {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  
  // Save subscription to Supabase
  await supabase.from('push_subscriptions').insert({
    parent_id: user.id,
    subscription: subscription
  });
}
```

### Send Notification (Edge Function)

```typescript
// In notify Edge Function
await webpush.sendNotification(subscription, JSON.stringify({
  title: 'Order Ready!',
  body: 'Your order #1234 is ready for pickup',
  icon: '/icons/icon-192.png',
  badge: '/icons/badge.png',
  data: { order_id: '...' }
}));
```

---

## Offline Queue

### Queue Structure (IndexedDB)

```typescript
interface QueuedOrder {
  id: string; // Local ID
  client_order_id: string; // Server idempotency key
  parent_id: string;
  child_id: string;
  items: OrderItem[];
  payment_method: string;
  notes: string;
  created_at: Date;
  retry_count: number;
}
```

### Queue Operations

```typescript
// Add to queue
await localQueue.enqueue({
  client_order_id: crypto.randomUUID(),
  parent_id: user.id,
  child_id: selectedChild.id,
  items: cartItems,
  payment_method: 'cash',
  notes: ''
});

// Process queue (called on network restore)
const queuedOrders = await localQueue.getAll();
for (const order of queuedOrders) {
  try {
    await processOrder(order);
    await localQueue.remove(order.id);
  } catch (error) {
    await localQueue.incrementRetry(order.id);
  }
}
```

---

## Installation Prompt

### Detect Installation Eligibility

```typescript
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton(); // Show custom UI
});
```

### Trigger Installation

```typescript
const installButton = document.getElementById('install-btn');
installButton.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response: ${outcome}`);
    deferredPrompt = null;
  }
});
```

---

## iOS Considerations

### Add to Home Screen (Manual)

iOS doesn't support `beforeinstallprompt`. Show instructions:

```text
1. Tap Share button (square with arrow)
2. Scroll and tap "Add to Home Screen"
3. Tap "Add"
```

### iOS Push Notifications

iOS 16.4+ supports web push with user gesture:

```typescript
const permission = await Notification.requestPermission();
```

---

## Testing PWA Features

### Lighthouse Audit

```bash
npm run build
npm run preview
```

Open Chrome DevTools → Lighthouse → Progressive Web App

**Target Score**: 90+

### Manual Tests

1. **Offline**: DevTools → Network → Offline
2. **Install**: Look for install icon in address bar
3. **Notifications**: Test on actual mobile device
4. **Background Sync**: Queue order offline, go online

---

## PWA Checklist

- [x] HTTPS enabled (required)
- [x] Manifest with icons
- [x] Service worker registered
- [x] Offline fallback page
- [x] Responsive design (mobile-first)
- [x] Fast load time (<3s)
- [x] Works across browsers

---

## Common Issues

### Service Worker Not Updating

```javascript
// Force update on page load (dev only)
if (import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(reg => reg.unregister());
  });
}
```

### Cache Not Clearing

```javascript
// Clear all caches
caches.keys().then(names => {
  names.forEach(name => caches.delete(name));
});
```

### iOS Not Caching

Ensure manifest has `apple-touch-icon`:

```html
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

---

## Resources

- [Web.dev PWA Guide](https://web.dev/progressive-web-apps/)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Workbox Documentation](https://developer.chrome.com/docs/workbox/)
