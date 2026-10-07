# Marks

Marks is a shared noticeboard for a small, specific room: my crit group, and
whoever else visits this repo. Type a name and a short line, and it joins
everyone else's on the wall --- visible the moment you post it, and still
there the next time you're back.

## What good means here

Good, for this app, isn't "used by many people." [Robin Sloan's *An App Can
Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/)
argues that software doesn't need scale or a business model to be worth
building --- it can be made, like a meal, for people you actually know, and
judged by whether it serves them rather than whether it grows. Marks is built
the same way: for a room of maybe a dozen people at most, not a public feed.
[Ink & Switch's *Malleable
Software*](https://www.inkandswitch.com/essay/malleable-software/) frames the
same idea at a different scale --- a luthier's workshop, tools built and
rearranged for exactly the work in front of them --- and that's the standard
I'm holding the schema to: the smallest shape that carries the one
interaction this crit needs, not a guess at what a later crit might want.

So: no accounts. A visitor is a random id in a cookie, set the first time
they show up --- good enough to tell two people apart, and to know a mark is
"yours" when you're back, but not to verify who anyone is. A name is just a
label someone types; two people can call themselves the same thing, and
that's fine for a room this size. The wall doesn't paginate, filter, or rank
--- it's short enough, for now, that reading top to bottom is the whole
interface.

## Live

The wall is real-time: a mark posted in one tab appears in every other open
tab within about a second, without a reload. It travels over server-sent
events, the simplest thing that carries one direction of news, and needs no
dependency. Reconnecting after a drop replays whatever you missed. The header
shows whether you're connected and how many people are on the wall right now,
as a count, never names. Why a count and not names is written up in
[ADR 1: presence](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-bada-5/blob/main/docs/adr/0001-presence.md).

The rest borrows from the small web's guestbooks, Atabook (123guestbook's
successor) above all. Marks are numbered, show how long ago they were left,
and can link your name to your own site. A few smileys turn into emoji. Each
visitor gets a steady colour, taken from The Unsent Project, so you can spot
one person's marks without an account. A hidden field and a limit of one mark every ten
seconds keep bots and accidental double-posts off the wall.

## What's deliberately not here yet

Server-side logging (crit 11's bar), names in the presence count (see the
ADR), and any way to edit or delete a mark once it's posted. That last one
is a real decision, not an oversight: a home-cooked app doesn't need an undo
button its author doesn't want, and a wall where marks are permanent is a
simpler, more honest promise than one that pretends to be moderatable. If
that turns out wrong once real people are leaving real marks, it's cheap to
add.

## What I read to get here

- Robin Sloan, [*An App Can Be a Home-Cooked
  Meal*](https://www.robinsloan.com/notes/home-cooked-app/) and its
  [five-year follow-up](https://www.robinsloan.com/lab/five-years-of-home-cooked-apps/)
- Ink & Switch, [*Malleable
  Software*](https://www.inkandswitch.com/essay/malleable-software/)
- the final project brief's own pointers toward the small web and games made
  for a handful of friends, which sent me looking for both of the above
