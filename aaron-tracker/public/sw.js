// Service Worker for Web Push Notifications — plain script (no ES modules)
var SITE_URL = 'https://trackanaaron.vercel.app';

// Show notification when push arrives from server
self.addEventListener('push', function (event) {
  var payload = { title: 'Aaron Update', body: '', url: SITE_URL };
  if (event.data) {
    try { payload = Object.assign(payload, JSON.parse(event.data.text())); }
    catch (e) { payload.body = event.data.text(); }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || SITE_URL },
      vibrate: [200, 100, 200],
      requireInteraction: false,
      tag: 'aaron-update',   // replaces previous notification of same tag
      renotify: true,        // still vibrates/alerts even when replacing
    })
  );
});

// Open/focus the tracker when notification is tapped
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || SITE_URL;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url === targetUrl && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// Take control of all open tabs immediately on activation
self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});
