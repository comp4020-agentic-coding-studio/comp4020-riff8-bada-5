import { randomUUID } from "node:crypto";
import { expect, inject, it } from "vitest";
import { hueFor } from "../src/render.ts";

// The core interaction this crit is about: post a mark, it shows up, and it
// distinguishes who left it. Everything here runs against the RUNNING app
// (see spec/global-setup.ts), same as invariants.test.ts.
const baseUrl = inject("baseUrl");

async function postMark(name: string, body: string): Promise<{ setCookie: string }> {
  const res = await fetch(new URL("/", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name, body }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  return { setCookie: res.headers.get("set-cookie") ?? "" };
}

it("a posted mark shows up on the wall", async () => {
  const marker = `mark-${randomUUID()}`;
  await postMark("Test Visitor", marker);
  const res = await fetch(new URL("/", baseUrl));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain(marker);
});

it("rejects a mark with an empty body without storing it", async () => {
  const marker = `empty-${randomUUID()}`;
  await postMark(marker, "");
  const res = await fetch(new URL("/", baseUrl));
  expect(await res.text()).not.toContain(marker);
});

it("rejects a name made only of zero-width characters", async () => {
  const marker = `zwsp-${randomUUID()}`;
  await postMark("​​​", marker);
  const res = await fetch(new URL("/", baseUrl));
  expect(await res.text()).not.toContain(marker);
});

it("accepts a name that merely contains a zero-width character", async () => {
  const marker = `zwsp-ok-${randomUUID()}`;
  await postMark(`Jo​hn`, marker);
  const res = await fetch(new URL("/", baseUrl));
  expect(await res.text()).toContain(marker);
});

it("still serves the page when a cookie value is malformed percent-encoding", async () => {
  const res = await fetch(new URL("/", baseUrl), {
    headers: { Cookie: "visitor=%" },
  });
  expect(res.status).toBe(200);
});

it("issues a fresh visitor cookie per anonymous request", async () => {
  const a = await postMark("A", `a-${randomUUID()}`);
  const b = await postMark("B", `b-${randomUUID()}`);
  expect(a.setCookie).toMatch(/^visitor=/);
  expect(b.setCookie).toMatch(/^visitor=/);
  expect(a.setCookie).not.toBe(b.setCookie);
});

// Crit 9: real-time. Posted marks reach every open /events stream, and a
// reconnecting stream gets what it missed.

async function postJson(
  fields: Record<string, string>,
  visitor = randomUUID(),
): Promise<{ status: number; id?: number; error?: string }> {
  const res = await fetch(new URL("/", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Cookie: `visitor=${visitor}`,
    },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, ...(await res.json()) };
}

// Reads an SSE stream until `needle` shows up or `ms` passes; resolves with
// everything read so far either way.
async function readStreamUntil(path: string, needle: string, ms: number, headers = {}): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(new URL(path, baseUrl), { headers, signal: controller.signal });
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    while (!seen.includes(needle)) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
  } catch {
    // aborted: the timeout ran out
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return seen;
}

it("delivers a mark to an open event stream within a second", async () => {
  const marker = `live-${randomUUID()}`;
  const reading = readStreamUntil("/events", marker, 1000);
  // give the stream a moment to register before posting
  await new Promise((resolve) => setTimeout(resolve, 100));
  const posted = Date.now();
  await postJson({ name: "Live", body: marker });
  const seen = await reading;
  expect(seen).toContain(marker);
  expect(Date.now() - posted).toBeLessThan(1000);
});

it("replays marks missed since Last-Event-ID on reconnect", async () => {
  const first = await postJson({ name: "Before", body: `before-${randomUUID()}` });
  const marker = `missed-${randomUUID()}`;
  await postJson({ name: "Missed", body: marker });
  const seen = await readStreamUntil("/events", marker, 1000, { "Last-Event-ID": String(first.id) });
  expect(seen).toContain(marker);
  expect(seen).toMatch(/^id: \d+$/m);
});

it("tells every stream how many people are here", async () => {
  const seen = await readStreamUntil("/events", "event: presence", 1000);
  expect(seen).toMatch(/event: presence\ndata: \d+/);
});

// Borrowed from atabook / small-web guestbooks.

it("links a name to an http(s) website, and drops any other scheme", async () => {
  const good = `site-${randomUUID()}`;
  const bad = `jsurl-${randomUUID()}`;
  await postJson({ name: "Linked", body: good, website: "https://example.com/me" });
  await postJson({ name: "Sneaky", body: bad, website: "javascript:alert(1)" });
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).toContain(good);
  expect(html).toContain(bad);
  expect(html).toContain('href="https://example.com/me" rel="nofollow ugc noopener"');
  expect(html).not.toContain("javascript:alert");
});

it("stores nothing when the honeypot field is filled", async () => {
  const marker = `bot-${randomUUID()}`;
  const res = await postJson({ name: "Bot", body: marker, contact: "buy now" });
  expect(res.status).toBe(200);
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).not.toContain(marker);
});

it("turns smileys into emoji while still escaping markup", async () => {
  const marker = `smile-${randomUUID()}`;
  await postJson({ name: "Happy", body: `${marker} :) <3 (it') <script>x</script>` });
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).toContain(`${marker} 🙂 ❤️ (it&#39;) &lt;script&gt;x&lt;/script&gt;`);
});

it("rate-limits a second mark from the same visitor and says so", async () => {
  const visitor = randomUUID();
  const first = `rate-1-${randomUUID()}`;
  const second = `rate-2-${randomUUID()}`;
  expect((await postJson({ name: "Quick", body: first }, visitor)).status).toBe(200);
  const res = await fetch(new URL("/", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `visitor=${visitor}` },
    body: new URLSearchParams({ name: "Quick", body: second }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/?e=slow");
  const html = await (await fetch(new URL("/?e=slow", baseUrl))).text();
  expect(html).not.toContain(second);
  expect(html).toContain("Slow down a moment");
});

it("gives the same visitor the same hue, without exposing the visitor id", async () => {
  const visitor = randomUUID();
  const marker = `hue-${randomUUID()}`;
  const { id } = await postJson({ name: "Colour", body: marker }, visitor);
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).not.toContain(visitor);
  // the hue on the page is the one derived from that visitor id, every time
  expect(html).toContain(`id="mark-${id}" data-id="${id}" style="--hue: ${hueFor(visitor)}">`);
  expect(hueFor(visitor)).toBe(hueFor(visitor));
  const hues = new Set(Array.from({ length: 20 }, () => hueFor(randomUUID())));
  expect(hues.size).toBeGreaterThan(1);
});

it("keeps a whole mark in one event when its body has a lone carriage return", async () => {
  const marker = `cr-${randomUUID()}`;
  const reading = readStreamUntil("/events", marker, 1000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await postJson({ name: "Return", body: `head\r${marker}` });
  const seen = await reading;
  expect(seen).toContain(marker);
  // EventSource treats a bare \r as a line break, which would split the mark
  expect(seen).not.toMatch(/\r/);
});

it("replays only what came after Last-Event-ID, not the mark already seen", async () => {
  const seenBody = `seen-${randomUUID()}`;
  const first = await postJson({ name: "Seen", body: seenBody });
  const marker = `after-${randomUUID()}`;
  await postJson({ name: "After", body: marker });
  const replay = await readStreamUntil("/events", marker, 1000, { "Last-Event-ID": String(first.id) });
  expect(replay).toContain(marker);
  expect(replay).not.toContain(seenBody);
});

it("shows a notice instead of failing silently when a mark is empty", async () => {
  const res = await fetch(new URL("/", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: "Blank", body: "   " }).toString(),
    redirect: "manual",
  });
  expect(res.headers.get("location")).toBe("/?e=empty");
  const html = await (await fetch(new URL("/?e=empty", baseUrl))).text();
  expect(html).toContain("A mark needs a name and a few words.");
});
