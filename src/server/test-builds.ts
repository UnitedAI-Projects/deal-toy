import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { consume } from "./builds";

const facts = {
  units: "mm",
  bounds: [1, 2, 3],
  volume_mm3: 6,
  solids: 1,
  valid: true,
  manufacturing_approval: "not_reviewed",
};

/**
 * Runs a queued job through the consumer with a mock CAD container: builds reply with five
 * artifacts carrying `record` as inspect.json; measure jobs reply with `measure(requests)`.
 */
export async function finish(
  jobId: string,
  record: unknown,
  options: {
    measure?: (requests: { key: string }[]) => unknown;
    status?: number;
  } = {},
) {
  const artifacts = [
    "model.step",
    "model.stl",
    "model.glb",
    "facts.json",
    "inspect.json",
  ].map((name) => ({
    name,
    mediaType: "ignored",
    base64: btoa(
      name === "facts.json"
        ? JSON.stringify(facts)
        : name === "inspect.json"
          ? JSON.stringify(record)
          : "ISO-10303-21; bytes",
    ),
  }));
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const container = {
    fetch: vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      const body = (await request.json()) as Record<string, unknown>;
      calls.push({ path, body });
      if (path === "/measure")
        return Response.json(
          options.measure?.(body.requests as { key: string }[]) ?? {
            results: [],
          },
          { status: options.status ?? 200 },
        );
      return Response.json({ artifacts });
    }),
    destroy: vi.fn(async () => {}),
  };
  await consume(
    {
      body: { jobId },
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as Message<unknown>,
    {
      DB: env.DB,
      ARTIFACTS: env.ARTIFACTS,
      BUILDS: env.BUILDS,
      DAILY_BUILD_LIMIT: env.DAILY_BUILD_LIMIT,
      CAD: { getByName: () => container },
    } as unknown as Env,
  );
  return calls;
}
