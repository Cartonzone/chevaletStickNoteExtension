# Changelog

Written for the person installing it, not for the person who wrote it. Dates are the release
date; the version notes on addons.mozilla.org are copied from here.

## The store skips from 0.0.8 to 0.0.16, and here is why

If you installed Chevalet Note from addons.mozilla.org you are on **0.0.8**, and five versions
appeared on GitHub over the following four days without your browser ever offering you one of
them. That was a mistake at this end, not at yours.

Firefox updates an add-on from the store and from nowhere else. Those builds were signed
through Mozilla's *unlisted* channel — which produces a file you can install by hand, and
nothing more — so none of them ever reached the store. A version number cannot be reused once
Mozilla has signed it, in either channel, so those five are spent and cannot be re-released.

**0.0.16 is all eight of them at once**, published properly. Everything below happened between
0.0.8 and now; it is grouped by the version it was written in, because that is the honest
record, but as far as the store is concerned it arrives in one update.

---

## 0.0.16 — 8 September 2026

**The same code again, and this time through the listed channel.**

## 0.0.15 — 8 September 2026

Meant for the store, and it missed. The upload form asks *how to distribute this version*
before it asks for the file -- **On this site** or **On your own** -- and the second is the
unlisted channel. It went to the second. Same result as 0.0.9 to 0.0.13, by a different route:
those five were the signing script's default, this one was a radio button.

## 0.0.14 — 8 September 2026

Hand-install only, deliberately. Signed unlisted so the fix below could be installed the day it
was written.

**Notes going transparent and unusable, needing a page refresh.** Holding Alt makes the notes
on a page translucent and lets you read and click what is underneath, which is a feature — but
it trusted `keydown` and `keyup` to arrive in pairs, and on Windows they do not. Alt also
reaches for the browser's menu bar, so the release can be delivered to the browser instead of
the page, and the notes stay ghosted with nothing to bring them back but a reload. Because the
way to *make* a note is Alt + double-click, this happened most often right after creating one.

Now: a click, a keystroke, the window losing focus or the tab being hidden all clear it, the
gesture needs Alt held for a quarter of a second so a note is never created through a flash of
translucency, and twelve checks in a real Firefox cover the stuck case specifically.

**Nothing else changed.** This release exists to carry 0.0.9–0.0.13 to the store.

## 0.0.13 — 6 September 2026

- **"This section"** — a note can now be pinned to a part of a site rather than one page or all
  of it. On `example.com/blog/a-post` that means every page under `/blog/`, and the note's label
  tells you which pages it means before you commit to it.
- **Bold that is actually bold**, for the typefaces that have a bold to bundle: Handwriting,
  Grotesk and both Persian faces.
- **An edit made in a tab now shows in an open cabinet**, immediately. The other direction
  already worked.

## 0.0.12 — 5 September 2026

- **Persian, as a language you choose.** About 230 strings: the cabinet, settings, the keyboard
  reference, the popup, and a note's own toolbar. The layout mirrors, rather than just changing
  words. English stays the default, and *follow the browser* is a third option.
- **"Check for update" got stuck on "Checking…" forever.** It asked for its permission from the
  wrong place, where Firefox could never grant it. It asks properly now, and gives up after
  fifteen seconds instead of hanging.
- **One settings screen instead of two.** The same switches existed in the cabinet and on the
  add-on's options page, laid out differently, with no indication which one was real. They live
  in the cabinet now.
- **Where a note shows** is yours to pick: this page, this section, this whole site, or every
  page. Three of those four existed in the code and were unreachable.
- **Hold Alt** to make the notes translucent and read — or click — the page underneath.
- **Edit a note's text from the cabinet**, which was the last thing it could not do.

## 0.0.11 — 5 September 2026

- **Notes were not being saved as you typed.** A note you wrote and then reloaded came back
  empty unless you had happened to press a formatting shortcut while writing it. This is the
  most serious bug this add-on has had and it was present in four releases.
- **Notes no longer leak across a single-page app's routes.** On a site that changes the URL
  without loading a new page, a note pinned to one page appeared on all of them.

## 0.0.10 — 5 September 2026

- **Six typefaces are bundled**, so the Persian ones look right on a machine that does not have
  them installed, and so no note has ever to fetch anything from the network to render.
- **Version history.** Every note keeps its recent versions and you can go back to one; it
  survives a browser restart.
- **A backup that runs itself**, on a schedule you set, and **import now writes** rather than
  only telling you what it found.
- **Notes can leave** as Markdown files or as a single HTML page.
- **The dark theme was redrawn** as a design rather than an inversion of the light one: graphite
  surfaces rather than black, with every text-and-background pair measured for contrast.
- **Every shortcut was broken on a non-Latin keyboard layout.** One line, comparing the wrong
  property of the key event.
- **Four settings that did nothing were removed.** A switch that does not do what it says is
  worse than a missing feature.

## 0.0.9 — 4 September 2026

- The privacy policy claimed the add-on made no network requests. The opt-in update check made
  that false, so the wording was corrected. The update check remains off by default and asks for
  permission at the moment you use it.

## 0.0.8 and earlier — 4 September 2026 and before

The version on the store today. See the repository's history.
