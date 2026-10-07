import { createHash } from "node:crypto";
import type { Mark } from "./db.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const timeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  dateStyle: "medium",
  timeStyle: "short",
});

const relativeFormat = new Intl.RelativeTimeFormat("en-AU", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

// "3 minutes ago", "yesterday". src/client.js has the same function so
// the labels keep ticking over without a reload; keep the two in step.
export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

// A stable colour per visitor, so one person's marks read as theirs without an
// account. It's a hash of the id, never the id itself: the visitor cookie IS
// someone's identity here, so it must not reach other people's pages.
export function hueFor(visitorId: string): number {
  return createHash("sha256").update(visitorId).digest().readUInt16BE(0) % 360;
}

const SMILEYS: Record<string, string> = {
  ":)": "🙂",
  ":(": "🙁",
  ":D": "😄",
  ";)": "😉",
  "<3": "❤️",
};
const SMILEY_PATTERN = /(:\)|:\(|:D|;\)|<3)/;

// Smileys are matched on the raw text and everything between them is escaped
// separately. Swapping after escaping would turn `it's)` (escaped to
// `&#39;)`) into a broken entity, since `;)` is a smiley.
export function renderBody(raw: string): string {
  return raw
    .split(SMILEY_PATTERN)
    .map((part, i) => (i % 2 === 1 ? (SMILEYS[part] ?? escapeHtml(part)) : escapeHtml(part)))
    .join("");
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 1rem/1.5 system-ui, sans-serif;
    max-width: 38rem;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  header p { color: color-mix(in srgb, currentColor 65%, transparent); }
  .status { font-size: 0.85rem; margin: 0.25rem 0 0; }
  .status .dot { color: hsl(140 60% 40%); }
  .status.down .dot { color: hsl(30 80% 50%); }
  .notice {
    padding: 0.5rem 0.75rem;
    border: 1px solid hsl(30 80% 50%);
    border-radius: 6px;
    margin: 1rem 0 0;
  }
  form { display: grid; gap: 0.75rem; margin: 1.5rem 0 2rem; }
  form p { margin: 0; }
  label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
  .optional { font-weight: 400; color: color-mix(in srgb, currentColor 65%, transparent); }
  input, textarea {
    width: 100%;
    font: inherit;
    padding: 0.5rem;
    box-sizing: border-box;
  }
  .hint { font-size: 0.85rem; color: color-mix(in srgb, currentColor 65%, transparent); margin: 0.25rem 0 0; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  button {
    font: inherit;
    padding: 0.5rem 1rem;
    width: fit-content;
    cursor: pointer;
  }
  .count { margin: 0 0 0.75rem; font-size: 0.85rem; color: color-mix(in srgb, currentColor 65%, transparent); }
  .new-pill {
    position: sticky;
    top: 0.5rem;
    display: block;
    margin: 0 auto 0.75rem;
    border-radius: 1em;
    z-index: 1;
  }
  .new-pill[hidden] { display: none; }
  ol.marks { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
  .mark {
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-left: 4px solid hsl(var(--hue, 0) 55% 50%);
    border-radius: 6px;
    background: hsl(var(--hue, 0) 55% 50% / 0.06);
  }
  .mark.new { animation: arrive 250ms ease-out; }
  @keyframes arrive { from { opacity: 0; transform: translateY(-0.5rem); } }
  @media (prefers-reduced-motion: reduce) { .mark.new { animation: none; } }
  .mark-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.5rem;
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
  }
  .mark-num, .mark-head time { color: color-mix(in srgb, currentColor 65%, transparent); }
  .mark-name { font-weight: 700; font-size: 1rem; }
  .mark-head time { margin-left: auto; }
  .mark-body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .badge {
    display: inline-block;
    font-size: 0.75rem;
    border: 1px solid currentColor;
    border-radius: 1em;
    padding: 0 0.5em;
  }
  .empty { color: color-mix(in srgb, currentColor 65%, transparent); }
  footer { margin-top: 3rem; font-size: 0.85rem; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// One entry on the wall. With no visitorId (a live broadcast going to every
// tab) there's no "yours" badge: the poster's own tab adds it client-side,
// from the id its POST returned.
export function markItem(mark: Mark, visitorId: string | null, now: Date = new Date()): string {
  const mine = visitorId !== null && mark.visitor_id === visitorId;
  const name = escapeHtml(mark.name);
  const who = mark.website
    ? `<a class="mark-name" href="${escapeHtml(mark.website)}" rel="nofollow ugc noopener">${name}</a>`
    : `<span class="mark-name">${name}</span>`;
  return `<li class="mark${mine ? " mine" : ""}" id="mark-${mark.id}" data-id="${mark.id}" style="--hue: ${hueFor(mark.visitor_id)}">
  <p class="mark-head"><span class="mark-num">#${mark.id}</span> ${who}${
    mine ? ' <span class="badge">yours</span>' : ""
  } <time datetime="${mark.created_at}" title="${timeFormat.format(new Date(mark.created_at))}">${relativeTime(mark.created_at, now)}</time></p>
  <p class="mark-body">${renderBody(mark.body)}</p>
</li>`;
}

export function marksCount(n: number): string {
  return `${n} ${n === 1 ? "mark" : "marks"}`;
}

// The list is always rendered, even empty, so a live mark has somewhere to
// land without the client building the wall's structure itself.
export function marksList(marks: Mark[], visitorId: string): string {
  const now = new Date();
  const items = marks.map((mark) => markItem(mark, visitorId, now)).join("\n");
  return `<p class="count" id="count"${marks.length === 0 ? " hidden" : ""}>${marksCount(marks.length)}</p>
<p class="empty" id="empty"${marks.length === 0 ? "" : " hidden"}>The wall's empty for now. A mark can be anything short — “made it to the crit :)” — and it'll still be here next week.</p>
<ol class="marks" id="wall">
${items}
</ol>`;
}
