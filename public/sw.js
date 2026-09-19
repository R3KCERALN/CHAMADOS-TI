// No fetch handler or offline cache: authenticated pages/data stay on the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Store only opaque event IDs for duplicate suppression, never payloads or credentials.
function seenEvents() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('central-push-receipts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('events');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
let deliveryChain = Promise.resolve();
async function showPush(event) {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (
    !payload ||
    typeof payload.tag !== 'string' ||
    payload.tag.length > 100 ||
    typeof payload.title !== 'string' ||
    typeof payload.body !== 'string' ||
    !/^\/notificacoes\/[a-zA-Z0-9_-]{1,100}$/.test(payload.url)
  )
    return;
  let database,
    shown = false;
  try {
    database = await seenEvents();
    const seen = await new Promise((resolve, reject) => {
      const request = database.transaction('events').objectStore('events').get(payload.tag);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (seen) return;
    await self.registration.showNotification(payload.title.slice(0, 150), {
      body: payload.body.slice(0, 150),
      icon: '/icons/icon-192.png',
      tag: payload.tag,
      renotify: false,
      data: { url: payload.url },
    });
    shown = true;
    await new Promise((resolve, reject) => {
      const tx = database.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      store.put(Date.now(), payload.tag);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          if (row.value < Date.now() - 7 * 86400000) row.delete();
          row.continue();
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Storage can be unavailable in private mode; notification tag still coalesces visible retries.
    if (!shown)
      await self.registration.showNotification(payload.title.slice(0, 150), {
        body: payload.body.slice(0, 150),
        tag: payload.tag,
        renotify: false,
        data: { url: payload.url },
      });
  } finally {
    database?.close();
  }
}
self.addEventListener('push', (event) => {
  deliveryChain = deliveryChain.catch(() => {}).then(() => showPush(event));
  event.waitUntil(deliveryChain);
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  if (typeof path !== 'string' || !/^\/notificacoes\/[a-zA-Z0-9_-]{1,100}$/.test(path)) return;
  event.waitUntil(
    (async () => {
      const url = new URL(path, self.location.origin).href;
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          const navigated = await client.navigate(url);
          if (navigated) {
            await navigated.focus();
            return;
          }
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
