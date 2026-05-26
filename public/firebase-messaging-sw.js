// =============================================================================
// BLOOD BIKE WEST — Firebase Cloud Messaging Service Worker
// Place this file in your project's /public folder
// =============================================================================

importScripts("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
importScripts("https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js");

// These values are safe to expose in the service worker
firebase.initializeApp({
  apiKey:      self.FIREBASE_API_KEY      || "PASTE_YOUR_FIREBASE_API_KEY",
  authDomain:  self.FIREBASE_AUTH_DOMAIN  || "PASTE_YOUR_AUTH_DOMAIN",
  projectId:   self.FIREBASE_PROJECT_ID   || "PASTE_YOUR_PROJECT_ID",
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID || "PASTE_YOUR_SENDER_ID",
  appId:       self.FIREBASE_APP_ID       || "PASTE_YOUR_APP_ID",
});

const messaging = firebase.messaging();

// Handle background notifications (when app is not in foreground)
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || "Blood Bike West", {
    body:  body  || "",
    icon:  icon  || "/icon-192.png",
    badge: "/icon-192.png",
    tag:   "bbw-notification",
    renotify: true,
    data:  payload.data || {},
  });
});

// Click on notification opens/focuses the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow("/");
    })
  );
});
