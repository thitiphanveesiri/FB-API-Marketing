// Service worker: shows push notifications and opens the app when one is tapped. No caching (the app always needs fresh data).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let n = {}; try { n = event.data ? event.data.json() : {}; } catch { n = { title: "การแจ้งเตือน", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(n.title || "Marketing Dashboard", {
    body: n.body || "", tag: n.tag || undefined, renotify: !!n.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: n.url || "/inbox" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
