import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { marked } from "marked";
import { getCookie, getVisitorId, setCookie } from "./cookies.ts";
import { escapeHtml, markItem, marksList, page } from "./render.ts";
import { insertMark, listMarks, marksAfter } from "./db.ts";
import { broadcastMark, canAccept, openStream } from "./live.ts";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_NAME = 40;
const MAX_BODY = 280;
const MAX_WEBSITE = 200;
const MAX_REQUEST_BYTES = 8192;
// One mark per visitor per window. In memory on purpose: a restart forgetting
// it costs nothing, and one machine means one map.
const RATE_LIMIT_MS = 10_000;
// A reconnect after a long sleep replays at most this many marks; anything
// older is on the page after a reload anyway.
const MAX_REPLAY = 500;

const CLIENT_JS = readFileSync(new URL("./client.js", import.meta.url), "utf8");

// What a redirect's `?e=` stands for. These render as text, so the notice is
// visible with JS off, where the 303 is the only response the visitor sees.
const NOTICES: Record<string, string> = {
  empty: "A mark needs a name and a few words.",
  slow: "Slow down a moment: one mark every 10 seconds.",
};

const lastPost = new Map<string, number>();

function tooSoon(visitorId: string, now: number): boolean {
  const last = lastPost.get(visitorId);
  if (last !== undefined && now - last < RATE_LIMIT_MS) return true;
  // Forget stale entries now and then, so the map stays the size of the
  // last ten seconds' posters rather than everyone ever.
  if (lastPost.size > 1000) {
    for (const [id, t] of lastPost) if (now - t >= RATE_LIMIT_MS) lastPost.delete(id);
  }
  lastPost.set(visitorId, now);
  return false;
}

// `.trim()` only strips whitespace (Unicode `Zs`), not zero-width/format
// characters (`Cf`, e.g. U+200B) — a string made of nothing else survives
// `.trim()` non-empty and reads as blank on the wall.
function hasVisibleContent(s: string): boolean {
  return /[^\s\p{Cf}]/u.test(s);
}

// Only http(s) becomes a link. Anything else (`javascript:`, `data:`, a typo)
// is dropped rather than failing the post: the mark matters, the link doesn't.
function cleanWebsite(raw: string): string | null {
  const s = raw.trim();
  if (s === "" || s.length > MAX_WEBSITE) return null;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function homePage(
  marks: ReturnType<typeof listMarks>,
  visitorId: string,
  lastName: string,
  notice: string | undefined,
): string {
  const latest = marks[0]?.id ?? 0;
  return page(
    "Marks",
    `<header>
  <h1>Marks</h1>
  <p>Leave a short mark. It'll still be here when you're back — <a href="/readme/">what this is for</a>.</p>
  <p class="status" id="status" hidden><span class="dot" aria-hidden="true">●</span> <span id="status-text">connecting…</span></p>
</header>
<main data-latest="${latest}">
${notice ? `<p class="notice" id="notice" role="status">${escapeHtml(notice)}</p>` : `<p class="notice" id="notice" role="status" hidden></p>`}
<form method="post" action="/" id="mark-form">
  <p>
    <label for="name">Your name</label>
    <input id="name" name="name" required maxlength="${MAX_NAME}" autocomplete="name" value="${escapeHtml(lastName)}">
  </p>
  <p>
    <label for="website">Your website <span class="optional">(optional)</span></label>
    <input id="website" name="website" type="url" maxlength="${MAX_WEBSITE}" autocomplete="url" placeholder="https://">
  </p>
  <p>
    <label for="body">Your mark</label>
    <textarea id="body" name="body" required maxlength="${MAX_BODY}" rows="2" aria-describedby="body-hint"></textarea>
    <span class="hint" id="body-hint">Up to ${MAX_BODY} characters. <span id="chars" hidden></span></span>
  </p>
  <div class="hp" aria-hidden="true">
    <label for="contact">Leave this empty</label>
    <input id="contact" name="contact" tabindex="-1" autocomplete="off">
  </div>
  <button type="submit">Leave it</button>
</form>
${marksList(marks, visitorId)}
</main>
<script src="/client.js" defer></script>`,
  );
}

// The form's own script asks for JSON; a plain form post (JS off) gets the
// redirect, with any problem carried in `?e=`.
function respond(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  result: { id?: number; error?: string },
): void {
  if ((req.headers.accept ?? "").includes("application/json")) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ...result, message: result.error && NOTICES[result.error] }));
    return;
  }
  res.writeHead(303, { Location: result.error ? `/?e=${result.error}` : "/" });
  res.end();
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const visitorId = getVisitorId(req, res);

      if (req.method === "GET" && url.pathname === "/") {
        const lastName = getCookie(req, "name") ?? "";
        const notice = NOTICES[url.searchParams.get("e") ?? ""];
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(homePage(listMarks(), visitorId, lastName, notice));
        return;
      }

      if (req.method === "POST" && url.pathname === "/") {
        const raw = await readBody(req);
        const params = new URLSearchParams(raw);
        // The honeypot: hidden from people, filled in by form-stuffing bots.
        // They get the same success response, so there's nothing to learn.
        if ((params.get("contact") ?? "") !== "") {
          respond(req, res, 200, {});
          return;
        }
        const name = (params.get("name") ?? "").trim().slice(0, MAX_NAME);
        const body = (params.get("body") ?? "").trim().slice(0, MAX_BODY);
        if (!hasVisibleContent(name) || !hasVisibleContent(body)) {
          respond(req, res, 400, { error: "empty" });
          return;
        }
        if (tooSoon(visitorId, Date.now())) {
          respond(req, res, 429, { error: "slow" });
          return;
        }
        const mark = insertMark(visitorId, name, body, cleanWebsite(params.get("website") ?? ""));
        setCookie(res, "name", name);
        broadcastMark(mark.id, markItem(mark, null));
        respond(req, res, 200, { id: mark.id });
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        if (!canAccept()) {
          res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "10" });
          res.end("too many open connections");
          return;
        }
        // A reconnect carries Last-Event-ID (the last mark id it saw); the
        // first connect carries `?after=`, the newest mark the page rendered,
        // so nothing posted between page load and connect is lost.
        const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
        const missed = Number.isSafeInteger(after) && after > 0 ? marksAfter(after).slice(-MAX_REPLAY) : [];
        openStream(
          res,
          visitorId,
          missed.map((m) => ({ id: m.id, html: markItem(m, null) })),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/client.js") {
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(CLIENT_JS);
        return;
      }

      if (req.method === "GET" && url.pathname === "/readme/") {
        const md = readFileSync("README.md", "utf8");
        const html = await marked.parse(md);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("About this app", `<main>${html}</main>`));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("something went wrong");
    }
  })();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on :${PORT}`);
});
