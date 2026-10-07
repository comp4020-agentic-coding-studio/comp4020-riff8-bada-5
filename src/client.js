// Enhancement only: everything here makes Marks live and quicker to use, and
// the page works without any of it (the form posts, the wall renders).

const main = document.querySelector("main");
const form = document.getElementById("mark-form");
const body = document.getElementById("body");
const chars = document.getElementById("chars");
const notice = document.getElementById("notice");
const wall = document.getElementById("wall");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const status = document.getElementById("status");
const statusText = document.getElementById("status-text");

let latest = Number(main.dataset.latest) || 0;
let present = 1;
// Ids this tab posted. The broadcast copy of a mark carries no "yours" badge
// (it goes to everyone), so this tab adds it to its own.
const mine = new Set();
// Marks that arrived while the reader was scrolled down the wall: held back
// so the page doesn't shift under them, until they ask for them.
const held = [];

// --- relative time, same rules as relativeTime() in src/render.ts ---------

const relativeFormat = new Intl.RelativeTimeFormat("en-AU", { numeric: "auto" });
const UNITS = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

function relativeTime(iso) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function refreshTimes() {
  for (const t of wall.querySelectorAll("time[datetime]")) {
    t.textContent = relativeTime(t.getAttribute("datetime"));
  }
}
setInterval(refreshTimes, 60_000);

// --- the wall ---------------------------------------------------------------

function updateCount() {
  const n = wall.children.length;
  count.textContent = `${n} ${n === 1 ? "mark" : "marks"}`;
  count.hidden = n === 0;
  empty.hidden = n !== 0;
}

function markAsMine(li) {
  if (li.classList.contains("mine")) return;
  li.classList.add("mine");
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "yours";
  li.querySelector(".mark-name").after(" ", badge);
}

const pill = document.createElement("button");
pill.type = "button";
pill.className = "new-pill";
pill.hidden = true;
wall.before(pill);

function scrolledPastTop() {
  return wall.getBoundingClientRect().top < 0;
}

function insert(li) {
  li.classList.add("new");
  if (mine.has(Number(li.dataset.id))) markAsMine(li);
  wall.prepend(li);
  updateCount();
}

function flushHeld() {
  while (held.length) insert(held.shift());
  pill.hidden = true;
}

pill.addEventListener("click", () => {
  flushHeld();
  wall.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});
addEventListener("scroll", () => {
  if (held.length && !scrolledPastTop()) flushHeld();
}, { passive: true });

function receive(html, id) {
  latest = Math.max(latest, id);
  if (document.getElementById(`mark-${id}`) || held.some((li) => Number(li.dataset.id) === id)) return;
  const template = document.createElement("template");
  // Server-rendered and escaped there (markItem in src/render.ts); nothing
  // here builds markup out of what a visitor typed.
  template.innerHTML = html.trim();
  const li = template.content.firstElementChild;
  // The reader's own mark always lands, even mid-scroll: they just posted it.
  if (scrolledPastTop() && !mine.has(id)) {
    held.push(li);
    pill.textContent = `↑ ${held.length} new ${held.length === 1 ? "mark" : "marks"}`;
    pill.hidden = false;
  } else {
    insert(li);
  }
}

// --- live connection --------------------------------------------------------

function showStatus(live) {
  status.hidden = false;
  status.classList.toggle("down", !live);
  statusText.textContent = live
    ? `live · ${present === 1 ? "just you here" : `${present} people here`}`
    : "reconnecting…";
}

function connect() {
  const events = new EventSource(`/events?after=${latest}`);
  events.addEventListener("open", () => showStatus(true));
  events.addEventListener("mark", (e) => receive(e.data, Number(e.lastEventId)));
  events.addEventListener("presence", (e) => {
    present = Number(e.data) || 1;
    showStatus(true);
  });
  events.addEventListener("error", () => {
    showStatus(false);
    // EventSource retries a dropped connection by itself, but gives up for
    // good on an error response (the server's 503 when it's full).
    if (events.readyState === EventSource.CLOSED) setTimeout(connect, 10_000);
  });
}
connect();

// --- the form ---------------------------------------------------------------

function showNotice(text) {
  notice.textContent = text ?? "";
  notice.hidden = !text;
}

// A `?e=` notice came from a no-JS redirect; once shown, a reload shouldn't
// show it again.
if (location.search) history.replaceState(null, "", location.pathname);

function updateChars() {
  chars.hidden = false;
  chars.textContent = `${body.value.length} / ${body.maxLength}`;
}
body.addEventListener("input", updateChars);
updateChars();

body.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const res = await fetch("/", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams(new FormData(form)),
    });
    const result = await res.json();
    if (!res.ok) {
      showNotice(result.message ?? "That didn't go through. Try again?");
      return;
    }
    showNotice(null);
    if (result.id) {
      mine.add(result.id);
      // The broadcast may have beaten this response here.
      const li = document.getElementById(`mark-${result.id}`);
      if (li) markAsMine(li);
    }
    body.value = "";
    updateChars();
  } catch {
    showNotice("Couldn't reach the wall. Check your connection and try again.");
  } finally {
    button.disabled = false;
    body.focus();
  }
});
