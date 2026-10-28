import { DurableObject } from "cloudflare:workers";
const TICKET_MS = 60_000;
/**
 * One instance per project relays activity to connected browsers. It holds no project data:
 * D1 is the record, and a browser loads history over HTTP before following this stream.
 * Browsers cannot send bearer headers on a WebSocket, so the authenticated HTTP API issues a
 * single-use ticket for this project and the socket presents it.
 */
export class ProjectLive extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  async issueTicket(email: string) {
    const stale = await this.ctx.storage.list<{ expires: number }>({
      prefix: "ticket:",
    });
    const expired = [...stale]
      .filter(([, grant]) => grant.expires < Date.now())
      .map(([key]) => key);
    if (expired.length) await this.ctx.storage.delete(expired);
    const ticket = crypto.randomUUID() + crypto.randomUUID();
    await this.ctx.storage.put(`ticket:${ticket}`, {
      email,
      expires: Date.now() + TICKET_MS,
    });
    return ticket;
  }
  async fetch(request: Request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const key = `ticket:${ticket}`;
    const grant = await this.ctx.storage.get<{
      email: string;
      expires: number;
    }>(key);
    await this.ctx.storage.delete(key);
    if (!grant || grant.expires < Date.now())
      return new Response("Ticket expired; request a new one", { status: 401 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [grant.email]);
    return new Response(null, { status: 101, webSocket: client });
  }
  async broadcast(message: string) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A closing socket is cleaned up by the runtime.
      }
    }
  }
  async webSocketMessage() {
    // Browsers only listen; keepalives are answered by the auto-response.
  }
  async webSocketClose(socket: WebSocket) {
    try {
      socket.close(1000, "closing");
    } catch {
      // Already closed.
    }
  }
}
