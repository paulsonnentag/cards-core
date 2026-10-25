// Registers the service worker that serves package files and resolves once it controls this page
export async function registerServiceWorker(path: string): Promise<void> {
  const registration = await navigator.serviceWorker.register(path, {
    type: "module",
  });
  if (navigator.serviceWorker.controller) return;
  // a hard reload bypasses an active worker for this load, and it won't claim the page again
  if (!registration.installing && !registration.waiting) location.reload();
  await new Promise((resolve) =>
    navigator.serviceWorker.addEventListener("controllerchange", resolve, {
      once: true,
    }),
  );
}
