/** Start the version-pinned CAD image and submit a build exactly once. */
export async function fetchCad(container: Container, request: Request) {
  if (!container.running) {
    const image = container.images.cad;
    if (!image) throw new Error("CAD image is not configured");
    container.start({ image, instance: "standard-1", enableInternet: false });
  }
  await container.setInactivityTimeout(90_000);
  const port = container.getTcpPort(8080);
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await port.fetch("http://cad/health", {
        signal: AbortSignal.timeout(2_000),
      });
      ready = response.ok;
      await response.body?.cancel();
      if (ready) break;
    } catch {
      // Only readiness is retried; a build POST must never be replayed.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("CAD container did not become ready within 60s");
  return port.fetch(request, { signal: AbortSignal.timeout(90_000) });
}
