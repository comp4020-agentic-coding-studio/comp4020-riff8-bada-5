import type { ServerResponse } from "node:http";

// Server-sent events over plain node:http: every open tab holds one
// `GET /events` response open and the server writes to all of them. One
// direction is all Marks needs (posting still goes through the form), so
// there's no WebSocket and no dependency.

// A pod of four opening the app at once is the expected crowd; this is a
// ceiling so a runaway client can't hold every socket on a 256 MB machine.
const MAX_CLIENTS = 200;
// Fly's proxy drops a connection that's been silent for a while, so each one
// gets an SSE comment line on this interval.
const HEARTBEAT_MS = 25_000;

interface Client {
  res: ServerResponse;
  visitorId: string;
}

const clients = new Set<Client>();

// Presence counts people, not tabs: two tabs from one visitor cookie are one
// person (see docs/adr/0001-presence.md).
function presentCount(): number {
  return new Set([...clients].map((c) => c.visitorId)).size;
}

function send(res: ServerResponse, event: string, data: string, id?: number): void {
  let out = `event: ${event}\n`;
  if (id !== undefined) out += `id: ${id}\n`;
  for (const line of data.split("\n")) out += `data: ${line}\n`;
  res.write(`${out}\n`);
}

function broadcastPresence(): void {
  const count = String(presentCount());
  for (const c of clients) send(c.res, "presence", count);
}

export function canAccept(): boolean {
  return clients.size < MAX_CLIENTS;
}

// Opens the stream, replays anything the client missed, and keeps it
// registered until the socket closes.
export function openStream(
  res: ServerResponse,
  visitorId: string,
  missed: { id: number; html: string }[],
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  // Tells EventSource how long to wait before reconnecting after a drop.
  res.write("retry: 2000\n\n");
  for (const m of missed) send(res, "mark", m.html, m.id);

  const client: Client = { res, visitorId };
  clients.add(client);
  broadcastPresence();

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
    broadcastPresence();
  });
}

// `html` is the server-rendered, already-escaped `<li>` for the mark, so the
// client inserts it as-is and never builds markup from user text itself.
export function broadcastMark(id: number, html: string): void {
  for (const c of clients) send(c.res, "mark", html, id);
}
