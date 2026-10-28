import { afterEach, expect, it, vi } from "vitest";
import { fetchCad } from "./cad-runtime";

function runtime() {
  const fetch = vi.fn();
  const container = {
    running: false,
    images: { cad: "registry.cloudflare.com/test/cad@sha256:123" },
    start: vi.fn(),
    setInactivityTimeout: vi.fn().mockResolvedValue(undefined),
    getTcpPort: vi.fn(() => ({ fetch })),
  };
  return { container, fetch, binding: container as unknown as Container };
}
const request = () =>
  new Request("http://cad/build", { method: "POST", body: "{}" });
afterEach(() => vi.useRealTimers());

it("waits for readiness before forwarding once with isolated startup options", async () => {
  const { container, binding, fetch } = runtime();
  fetch.mockRejectedValueOnce(new Error("port not listening"));
  fetch.mockResolvedValueOnce(new Response("ready"));
  fetch.mockResolvedValueOnce(new Response("built"));
  const response = await fetchCad(binding, request());
  expect(await response.text()).toBe("built");
  expect(container.start).toHaveBeenCalledWith({
    image: container.images.cad,
    instance: "standard-1",
    enableInternet: false,
  });
  expect(container.setInactivityTimeout).toHaveBeenCalledWith(90_000);
  expect(
    fetch.mock.calls.filter(([input]) => input instanceof Request),
  ).toHaveLength(1);
});

it("fails closed when the named CAD image is absent", async () => {
  const { container, binding, fetch } = runtime();
  container.images.cad = "";
  await expect(fetchCad(binding, request())).rejects.toThrow(
    "image is not configured",
  );
  expect(container.start).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("bounds readiness failure without submitting a build", async () => {
  vi.useFakeTimers();
  const { binding, fetch } = runtime();
  fetch.mockResolvedValue(new Response(null, { status: 503 }));
  const result = expect(fetchCad(binding, request())).rejects.toThrow(
    "within 60s",
  );
  await vi.advanceTimersByTimeAsync(60_500);
  await result;
  expect(fetch.mock.calls.every(([input]) => typeof input === "string")).toBe(
    true,
  );
});

it("does not restart a running container or retry a failed build POST", async () => {
  const { container, binding, fetch } = runtime();
  container.running = true;
  fetch.mockResolvedValueOnce(new Response("ready"));
  fetch.mockRejectedValueOnce(new Error("build connection lost"));
  await expect(fetchCad(binding, request())).rejects.toThrow(
    "build connection lost",
  );
  expect(container.start).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});
