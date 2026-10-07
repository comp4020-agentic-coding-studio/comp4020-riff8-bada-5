# 1. Show presence as an anonymous count

Date: 2026-10-07. Status: accepted.

## Context

Marks went real-time for crit 9: a mark one person posts appears in every
other open tab within about a second, over server-sent events. With several
people on the wall at once, the open question is whether they can see each
other being there, and how.

The README sets the standard. Marks is for a room of maybe a dozen people who
know each other, and there are no accounts. A visitor is a random id in a
cookie, and a name is "just a label someone types," supplied only when you
post. Whatever presence shows has to be honest about that: the app doesn't
know who you are, only that you're a different browser from the next person.

## Options considered

1. **No presence.** The wall updates live and nothing else does. It's the
   simplest, and nothing is shown that could be wrong. But a live wall with no
   sign of anyone else reads as empty, especially at the crit, when four
   people open it at once and nobody has posted yet. The live connection
   is invisible until something happens.
2. **An anonymous count** ("live · 3 people here"). The server counts distinct
   visitor ids among open streams and broadcasts the number whenever it
   changes. It needs nothing the app doesn't already have.
3. **Names of who's here.** This is the warmest option, and the one the pod
   will argue for. But a name only exists after you've posted, so a lurker
   has no name to show. Either they appear as "someone," which is just
   option 2 with extra steps, or we'd have to ask for a name before letting
   people read, which the README's "type a name and a short line" never
   asked for. It would also turn the remembered `name` cookie into something
   broadcast to everyone on page load, which is more than anyone agreed to
   share by posting once last week.

## Decision

Option 2: an anonymous count of people (distinct visitor cookies, not tabs)
with a live connection, shown beside a connection indicator in the header:
"● live · just you here" / "● live · 3 people here", or "reconnecting…"
when the stream drops.

## Consequences

- At the crit, everyone sees the count go up as the pod opens the app, which
  is proof the app is live before anyone posts.
- You can tell *that* people are here, not *who*. In a room this small you
  can usually work out who from the person sitting next to you, and the app
  doesn't pretend to know more than a cookie can tell it.
- The count is approximate. One person in two browsers counts twice. A
  closed laptop counts until the connection times out. Someone with JS off
  isn't counted at all. That's acceptable for a number that's ambience, not
  an attendance record.
- It costs one Set of open streams in memory and a small `presence` event on
  every connect and disconnect, which is nothing at a dozen people. The server
  caps open streams at 200 so a misbehaving client can't exhaust a 256 MB
  machine.
- If the room asks for names later, option 3 can be built on the same
  stream. This choice doesn't close it off.
