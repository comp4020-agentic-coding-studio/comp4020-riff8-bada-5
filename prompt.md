# Brief: make Marks real-time, and give it the best of the small-web walls

Priority if time runs short: sections 1 and 2 (the crit's bars) first, then
section 3, then section 4. A smaller set done well and deployed beats
everything half-done.

You're picking up Marks at the end of crit 8. The brief you're working to is
crit 9, "All at once":
https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/api/crits/09-all-at-once.json
Fetch it fresh before you start. Nobody is available to answer questions, so
when something is ambiguous, decide by what `README.md` says good means, write
the decision down, and keep going.

## 1. Real-time (the crit's hard bar)

When one person posts a mark, it should appear in every other open tab within
about a second, with no reload.

- Use **server-sent events** (`GET /events`, `text/event-stream`) with plain
  `node:http`. Don't add a dependency for this. On the client, a small inline
  `EventSource` script inserts the new mark at the top of the wall, already
  rendered and escaped **on the server** (send the `<li>` HTML that
  `marksList` would produce, minus the "yours" badge, which the client adds
  by comparing visitor ids if it needs it).
- Posting must still work with JS off (the 303 redirect stays). With JS on,
  intercept the form, `fetch` POST it, clear the textarea, and keep the name.
  The poster's own mark arrives through the same SSE path as everyone
  else's, so there's exactly one insertion code path.
- When a client reconnects, it must not miss marks or show duplicates. Use
  SSE `id:` set to the mark id, plus `Last-Event-ID`, to replay what was
  missed. De-dupe by `data-id` on the `<li>`.
- Send a heartbeat comment every ~25 s so Fly's proxy doesn't drop idle
  connections. Check `fly.toml` concurrency settings still make sense.

## 2. The multi-user decision (the crit's other bar)

Make **presence** the decision: whether people can see who else is on the wall
right now, and how. Write it up as an ADR at `docs/adr/0001-presence.md`
(context, options considered, decision, consequences / what it costs). Options
to weigh: no presence at all; an anonymous count ("3 people here now"); names
of who's here. My lean is the anonymous count, since names would need a name
before you've posted and the README says a name is just a label. Pick what the
README's argument supports, though, and say why. Implement whatever you choose
over the same SSE stream. Link the ADR from `README.md` and add a short "Live"
section to the README. Keep the existing headings and their order, because
`spec/invariants.test.ts` checks them.

## 3. Borrow from atabook.org (classic guestbook feel)

https://atabook.org (feature list: https://atabook.org/features) is the
successor to 123guestbook, the small-web guestbook. Marks should feel like a
guestbook somebody cared about, not a bare list. Take these, and only these:

- **Numbered entries.** Show each mark as `#N` (its id) at the top of a
  card-style entry. Show the total count above the wall ("12 marks").
- **Entry layout.** Name in bold on the left, date on the right, body below.
  Give the entry a subtle border/background card instead of only a left rule.
  Keep it legible in both light and dark (`color-scheme` is already set).
- **Relative time.** Render "3 minutes ago" on the server, with the absolute
  time in the `<time>` element's `title`. A tiny script refreshes the
  relative labels every minute, and new live marks get the same treatment.
- **Optional website field.** Add an optional "Your website" input
  (`type=url`, max 200 chars). Store only `http:`/`https:` URLs, and reject
  anything else without failing the post. Render the name as a link with
  `rel="nofollow ugc noopener"`. This needs a nullable column: add it with an
  idempotent migration in `db.ts` (check `pragma table_info` first), because
  the live volume already has a `marks` table.
- **Smileys.** Convert a small fixed set (`:)` `:(` `:D` `;)` `<3`) to emoji at
  render time, **after** escaping. Store the raw text. Note that `<3` becomes
  `&lt;3` once escaped, so match accordingly.
- **Character counter** under the textarea (`0 / 280`), JS enhancement only.
- **Honeypot spam field.** Add a visually hidden input that real people leave
  empty. If it's filled, respond 303 as normal but don't store anything.

## 4. Borrow from other small, shared walls

Each of these sites does one thing well that fits Marks. Take the specific
idea listed for each, not the whole site.

- **The Unsent Project** (https://theunsentproject.com): each message has a
  colour, so the wall is memorable at a glance. Derive a stable hue from a
  hash of `visitor_id` and use it for the entry's accent (border or tint).
  That way you can recognise the same person's marks without accounts or a
  schema change. Check contrast in both light and dark, and never put the
  colour behind the text at a level that hurts legibility.
- **Padlet** (https://padlet.com): new posts arrive with a short fade/slide
  in, so you notice them. Animate live-inserted marks (under 300 ms), and
  turn the animation off under `prefers-reduced-motion`. Also take Padlet's
  "don't yank the page" behaviour: if the reader has scrolled down, don't
  insert silently above them. Show a small "↑ 2 new marks" pill that scrolls
  to the top when clicked. Make the empty state warmer and give it a hint of
  what a mark looks like.
- **Cbox** (https://www.cbox.ws), the no-signup shoutbox: posting feels
  instant. Make Ctrl/Cmd+Enter submit, keep focus in the textarea after
  posting, and show a clear inline error instead of silently doing nothing.
  Add a per-visitor **rate limit** (one mark per ~10 s, in memory, keyed by
  visitor id). A too-fast post redirects back with a short "slow down a
  moment" message, which must also work with JS off (e.g. a `?e=slow` query
  param the page renders as a notice). Apply the same pattern to the existing
  empty-mark rejection, which currently fails silently.
- **Your World of Text** (https://www.yourworldoftext.com) and **One Million
  Checkboxes** (https://onemillioncheckboxes.com): shared live state, and you
  can tell when you're connected. Show a small connection indicator ("● live"
  / "reconnecting…") driven by `EventSource` open/error events, so a dropped
  connection is visible rather than looking like a quiet wall. Like OMC,
  survive a crowd: cap concurrent SSE connections at a sane number and clean
  up closed ones, so the whole pod opening it at once (the crit demo) can't
  leak memory.

## What not to borrow

Do **not** take atabook's accounts, owner moderation/approval queue, replies,
edit/delete, IP blocking, CSV import, avatars or ads. Don't take Padlet's
boards, accounts or uploads, Cbox's moderator tools, or YWOT's free-form
canvas editing. `CLAUDE.md` rules these out (no accounts, marks are
permanent, one interaction), and those rules stand. If a borrowed idea starts
needing a new dependency or a second store, drop it and note why in the
README.

## What good looks like / constraints

- Every rule in `CLAUDE.md` below the line still holds: escape all user text
  via `escapeHtml`, the core interaction works with JS off, there's one SQLite
  file, and there are no new runtime dependencies.
- Update `spec/marks.test.ts` with tests for the new behaviour. At minimum:
  an SSE client receives a mark posted by another request within 1 s;
  `Last-Event-ID` replay delivers missed marks; a `javascript:` website is
  not stored as a link; a filled honeypot stores nothing; smileys render and
  `<script>` in a body is still escaped; a second post from the same visitor
  inside the rate-limit window is not stored and gets the notice; the same
  visitor id always gets the same hue. Keep all existing tests and
  `spec/invariants.test.ts` green.
- Test real-time across two real browser sessions before you finish, not only
  with fetch.
- Commit in small, meaningful steps. This riff isn't marked, so don't write a
  reflection or a `PROCESS.md` entry.
- Keep `main` deployable. Deploy, then confirm on the live site that two tabs
  see each other's marks live and the presence indicator updates.
- Delete this `prompt.md` in your last commit, as `CLAUDE.md` instructs.
