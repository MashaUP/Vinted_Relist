# Vinted Relist

[🇮🇹 Italiano](README.md) · **🇬🇧 English** · [🇫🇷 Français](README.fr.md) · [🇪🇸 Español](README.es.md) · [🇩🇪 Deutsch](README.de.md)

An extension for **Brave and Chrome** that relists your Vinted listings in one click, one at a
time or in a queue, to bring them back to the top of the results without redoing them by hand.

**Version 2.7.1** · [Changelog (Italian)](CHANGELOG.md) · [Discord community](https://discord.gg/EPsbQCuAkx) ·
[Report a problem](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml) ·
[Support development on Ko-fi](https://ko-fi.com/mashaup)

> [!WARNING]
> **Unofficial project, use at your own risk.** It is not affiliated with or endorsed by Vinted,
> and automating actions on the website may not be allowed by Vinted's terms; Vinted can restrict
> or suspend accounts. **The author is not responsible** for what happens to your account, for
> lost or deleted listings, missed sales, or any abuse or misuse of the extension. Relisting
> **deletes** the old listing: views and favourites start again from zero. By installing it you
> accept the [full disclaimer](DISCLAIMER.md#english).

---

## Who it's for

Sellers who sell from their own Vinted wardrobe and often relist the same items: books, manga,
clothes, bundles. Instead of copying photos and text into a new listing and deleting the old one,
press **Relist** on the item's card, or select many and put them in a **queue** with a pause
between each one.

It's a free personal project with no server: everything stays in your browser. The interface is
available in **Italian, English, French, Spanish and German**.

It is distributed as a zip on GitHub and loaded as an unpacked extension — **it is not on the
Chrome Web Store**. **Try it first on an item you don't care much about.**

## Installation

1. Download **`Vinted_Relist-2.7.1.zip`** from the
   [GitHub release page](https://github.com/MashaUP/Vinted_Relist/releases) (under "Assets") or
   from the root of the repository.
2. Extract it **into a permanent folder**, e.g. `Documents\Vinted_Relist` (not the temporary
   folder Windows opens when you double-click the zip). The right folder is the one that contains
   `manifest.json`.
3. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode** (top right).
4. **Load unpacked** › choose the folder with `manifest.json`.
5. Open your wardrobe on Vinted **while logged in** and reload the page: the **Relist** and
   **Edit** buttons appear on the cards.

> Don't delete or move the folder after installing: the browser uses it every time.

### Updating

1. Popup › **Health** › **Check for update** (it also checks by itself every 12 hours and lets
   you know).
2. **Download the zip**: the popup checks its SHA-256 fingerprint and saves it in Downloads ›
   Vinted Relist. Extract it **into the folder that contains `Vinted_Relist`**, replacing the files
   (the zip already contains the `Vinted_Relist/` folder).
3. **Install the update**: the extension reloads. Then reload your Vinted tabs (F5).

## Quick guide

**0. Language.** The 🌐 button at the top of the popup and the dashboard opens the **Language**
panel: "Automatic" follows your browser's language, or pick Italiano, English, Français, Español
or Deutsch. The change applies everywhere straight away.

**1. One item.** On a card in your wardrobe:
- **Relist**: clones the listing and deletes the old one, right away;
- **Edit**: first change photos, title, description or price, see a preview of what changes, then
  publish.

**2. Many items (queue).** Tick the boxes on the cards (Shift+click for a range) › **Queue** ›
choose the options (price, text, interval between items, start time) › the check reads every item
**without publishing** and sorts them into ready, with warnings and blocked › **Start**. Keep a
Vinted tab open while the queue is working.

**3. While the queue is running.** Keep selecting items and press **Add to queue**: the **Edit
center** opens and they become a new **batch** with its own rules and interval. The queue doesn't
stop. **Manage** opens the queue page, where you can see, reorder, pause and fix everything.

**4. Listings already deleted by Vinted.** With [Vintory](https://github.com/MashaUP/Vintory)
export the listings ("For Vinted_Relist"), then Dashboard › **Relist from Vintory** › choose the
ZIP: the preview tells you which ones can be relisted, without deleting anything.

**5. If something goes wrong.** Popup › **Health**: extension status, diagnostics to copy and what
to do. An uncertain result becomes "to verify" and is never relisted automatically.

## What it does

- **Relisting:** clones the listing (photos, title, description, category, brand, size, condition,
  colours, model for phones, price, shipping) and deletes the old one, using the website's internal
  APIs and your session — no simulated clicks.
- **Safe order:** publish first, then delete (default). If Vinted rejects the new listing, the old
  one stays.
- **When in doubt, it doesn't relist:** without a clear answer from Vinted the item becomes "to
  verify" and you confirm it (also with **Verify publication**, which checks Vinted without
  publishing anything).
- **Only your listings:** buttons appear only in your own wardrobe; sold items are never relisted.
- **Listing editor:** reorder, rotate, crop and remove photos; title, description, price, colour;
  real-time checks and a completeness score; download the original photos.
- **Queue:** add, remove and reorder even while it's running; batches with their own rules and
  interval; status markers on the cards; timed pause; "Relist now"; bulk options (price by %, by
  euro or fixed, search and replace, extra line in the description); protections against Vinted's
  rate limits; history and CSV/JSON export.
- **Dashboard:** queue management, item groups (recent, stagnant, to improve…), possible
  duplicates, what works (views after 48 hours by day and time slot), history with before/after
  comparison and restore, **Relist from Vintory**.

## Tips: when to relist

- **Between different items, 15–20 minutes** (the queue's default interval). A few items at a
  time, generous pauses.
- **The same item every 5–7 days, never every day.**
- **Sunday evening, 8–10 pm** tends to be the best time; **Friday** the worst day; avoid 1–6 am.

These figures come from relisting-tool vendors ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
and can't be verified; after a few weeks the dashboard shows what works for your own wardrobe.

## Troubleshooting

Popup › **Health** › **Prepare diagnostics**: version, settings, queue status and recent errors,
without tokens, cookies, ids or addresses. You see it before copying it, and you can paste it on
Discord or in a bug report.

- **The buttons don't appear / "Profile not detected".** They only appear in your own wardrobe
  (`/member/<your id>`) once the extension has recognised your account. Reload a Vinted tab (F5)
  while logged in: tabs opened before installing or updating the extension don't count. In Health,
  **"Vinted requests"** shows when the extension last saw Vinted and whether the account cookie was
  there; if it says "new format", send us the diagnostics.
- **"Reload this page" after an update.** Reload the Vinted tab (F5): pages that were already open
  still run the old code.
- **Session errors** (since 2.7.1 the message says which one). In Health, the **"Session"** row
  shows whether the Vinted tab is ready. "Session expired": log in to Vinted again in that tab.
  "Token not found in any known form": Vinted may have changed the page, send us the diagnostics
  on Discord. A detected profile alone isn't enough to publish.
- **Phones: Vinted asks you to select the model.** Since 2.6 the model is copied automatically. If
  it still happens: open the listing on Vinted › **Edit** › check the model › save, then try again
  (the extension learns the fields of that category). If that's not enough, send us the
  diagnostics.
- **The queue stops with "Extension problem".** The reason is shown in the pause and in the
  diagnostics. Reloading the Vinted tab is usually enough; then **Resume**. Nothing was sent to
  Vinted.
- **Error 403 or 429.** That's Vinted's anti-bot protection: the queue slows down by itself.
  Increase the interval.
- **Broken icon, `ERR_FILE_NOT_FOUND`.** The browser can no longer find the folder: extract it to a
  permanent location and reload the extension from there.

## Privacy and permissions

Drafts, history, statistics, queue and notifications stay in your browser. **No telemetry, no
server, no data sent to the author.** The only requests outside Vinted go to GitHub, without
cookies or personal data: `version.json` for updates and `links.json` for the project links (can be
turned off in Settings › Advanced).

| Permission | Why it's needed |
|---|---|
| `storage` | settings, queue, inventory, history, notifications, language: all local |
| `webRequest` | read the session token, your id and the formats from Vinted's own requests |
| `alarms` | wake the queue at the right time and resume a timed pause |
| `notifications` | end-of-queue and update notifications |
| `idle` | irregular pace: no steps while you're away from the computer |
| `downloads` | downloaded photos, settings backups, queue exports |
| `vinted.*` and `*.vinted.net` sites | call Vinted's APIs and download photos from its CDN |

## What it doesn't do

- It doesn't bring the original listing back: views, favourites and age start from zero.
- It doesn't alter photos to dodge Vinted's checks.
- It doesn't work with the browser closed: you need the browser open and a Vinted tab.
- It doesn't update itself: it tells you, you extract the zip.

## Help and support

- **Questions and help:** the [Discord community](https://discord.gg/EPsbQCuAkx).
- **Bugs:** [open a report](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml)
  with version, browser, what happened and the diagnostics. **Never paste cookies, tokens or
  account data.**
- **Support development:** Vinted Relist is free; if it saves you time you can buy me a coffee on
  [Ko-fi](https://ko-fi.com/mashaup).

The technical documentation for developers is in Italian ([README](README.md#per-sviluppatori),
[docs/SVILUPPO.md](docs/SVILUPPO.md)).

## License and disclaimer

[MIT](LICENSE): you may use, modify and redistribute the code, including in your own projects, as
long as you keep the copyright notice. The software is provided **as is, without warranty**.

Vinted Relist is an independent project, **not affiliated with or endorsed by Vinted**. Use it at
your own risk: the author is not liable for account suspension or blocking, lost listings, missed
sales, or any abuse or misuse. Read the [full disclaimer](DISCLAIMER.md#english).
