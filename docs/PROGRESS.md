# Kota Hustle: Progress

_Last updated: 2026-11-17_

## Status

**Phase 1 (Foundation): done.** Phase 2 (money, jobs and the gacha core) is next.

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean (shared, server, client, scripts) |
| `npm test` (Vitest) | ✅ 34 unit tests |
| `npm run e2e` (Playwright, 2 browsers: desktop 1920×1080 + phone 390×844) | ✅ passes on the dev server and on the production build |
| Server boots, binds `0.0.0.0` and prints the LAN URL | ✅ |
| Real phone on the LAN | ⏳ needs you (see below) |

---

## How to test Phase 1 on your PC and phone

### 1. Start the server

```bash
npm install        # first time only
npm run dev
```

The terminal prints something like:

```
  Kota Hustle server running (development)
  Local:            http://localhost:3003
  Players join at:  http://192.168.0.28:3003   (Ethernet)
  Also try:         http://172.28.x.x:3003     (ZeroTier One ...)
```

> **Port note for this PC:** other programs already use ports 3000–3002, so the server picks the next free port
> (it was **3003** when I tested). Use the port the terminal shows. To pin it, copy `.env.example` to `.env` and set
> `PORT=3010` (any free port).

### 2. Allow it through Windows Firewall (first run only)

Windows will pop up **"Windows Defender Firewall has blocked some features of Node.js"**. Tick **Private networks**,
then click **Allow access**. If you missed it, go to *Windows Security → Firewall & network protection → Allow an app
through firewall → Node.js JavaScript Runtime*, then tick **Private**.

### 3. Play on the PC

1. Open the **Local** URL (e.g. `http://localhost:3003`) in Chrome or Edge.
2. **Register** a username and password, then build a character in the creator. Try every tab, 🎲 Randomise, and
   the ⟲/⟳ rotate buttons. Press **Let's hustle →**.
3. You spawn in **Dataran Sunway Square**. Walk with **WASD / arrow keys**. Buildings, highways and water block you.

### 4. Join from your phone

1. Connect the phone to the **same router** as the PC. The PC is on Ethernet (192.168.0.x), so the phone's WiFi
   must be on that same 192.168.0.x network, not a guest network.
2. On the phone, open the **"Players join at"** URL (e.g. `http://192.168.0.28:3003`). Don't use `localhost` on the phone.
3. Register a **second** account and create a character.

### 5. Things to check (Phase 1 acceptance)

- [ ] Both players see each other and walk smoothly (PC: keyboard. Phone: the joystick, bottom-left).
- [ ] **Chat:** press **Enter** (or tap 💬), type, press Enter. The message shows in the chat log and as a bubble over your head.
- [ ] **Emotes:** press **Q** then **1–5** (or tap 😀). Wave, dance, cry, flex and laugh animate for everyone.
- [ ] **Minimap** (top-right): **M** toggles it. Tap it, or 🗺️, for the full map with district names.
- [ ] Walking into a new district shows a "📍 The Strand" style banner.
- [ ] Stand at a building door: the "E Enter …" prompt appears. Interiors come in later phases.
- [ ] **Refresh** the page: you auto-login at the same spot with the same look.
- [ ] ⚙️ **Settings → Log out**, then log back in: same spot, same look.
- [ ] Log into the **same account on the other device**: the first one shows "You logged in on another device."
- [ ] Walk around, wait about 60 s: a green **"Saved ✓"** chip appears. ⚙️ Settings shows "Last saved: N s ago".
- [ ] Press **Ctrl+C** in the server terminal: it prints `Saved N online player(s)`. Start it again and players come back where they were.
- [ ] `server/backups/` contains `game-YYYYMMDD-HHmmss.db` files (one per start, and every 6 h; newest 14 kept). `npm run backup` makes one on demand.

**Two accounts on one PC:** use a second browser or a private window, or add `?profile=2` to the URL
(e.g. `http://localhost:3003/?profile=2`) so that tab keeps its own login.

**Phone can't connect?** (1) Firewall (step 2). (2) The phone must be on the same network. (3) Some routers have
"AP / client isolation" turned on, which blocks device-to-device traffic. Turn it off or try another WiFi.
(4) Try the other URLs the server printed.

### Production mode

```bash
npm run build
npm start
```

---

## Phase 1: what was built

- **Monorepo** (npm workspaces): `shared/` (types, zod schemas, config, map builder, collision), `server/`, `client/`, `scripts/`.
- **Server**: Express + Socket.IO bound to `0.0.0.0`. Prints LAN URLs (Wi‑Fi/Ethernet first; VPN adapters as "Also try").
  In dev, Vite runs as Express middleware, so dev and prod both use **one port** (phones get hot reload too).
- **Auth** (§3): register/login with bcrypt (cost 10). 32-byte random session token in localStorage, stored server-side
  as SHA-256. Login rate limit 5/min per IP. One active session per account (new login kicks the old device after
  saving it). The first account (or `ADMIN_USERNAME`) is admin.
- **Character creator** (§4): every category at or above the minimum counts. 12 skin tones plus a picker, 6 face shapes,
  3 heights, 3 builds, 10 eyes plus colour, 6 brows, 6 noses, 8 mouths, blush/freckles/beauty mark, 5 glasses,
  23 hairstyles plus colour and highlight, 4 tudung styles, cap/backwards cap/beanie/songkok, 6 facial hair styles,
  9 tops, 6 bottoms and 5 shoes, each with a colour picker. Live preview walks and rotates through 4 directions, plus Randomise.
  The appearance is validated on the server against `shared/config/character.json`.
- **Character art**: drawn in code (Canvas 2D), chibi proportions, baked into a 28-frame spritesheet per look:
  idle/walk × front/back/side, plus 5 emotes.
- **Map** (§5): 256×192 tiles (8,192×6,144 px), authored as data in `shared/map/town.json` and centred on
  **Menara Mitraland**, cross-checked against the reference screenshots. 12 districts: Dataran Sunway, Surian MRT,
  The Strand, Mitraland & The Cascades, Taman Kenanga, Seksyen 6, Community Forest Reserve, Rymba Hills, PJU 3,
  Damansara Timur, Surian Selatan and Utama Greens. ~600 buildings, real road names, E31/AH2 highways with
  underpasses and pedestrian bridges, decor (trees, lamps, benches, cars, fountains, Jobs Board). Unit tests check that
  no building overlaps a road and that every door and district is reachable from spawn.
- **Movement**: WASD/arrows plus a virtual joystick. Client-predicted, axis-separated collision (slides along walls),
  sent at 15 Hz. The server validates speed (token-bucket budget) and walls, and snaps cheaters back. Camera follows
  with smoothing. Zoom adapts to the screen size.
- **Multiplayer**: 15 Hz snapshots, with remote players interpolated about 110 ms in the past. Join/leave/appearance updates.
- **Chat + bubbles + emotes**: global chat (rate limited, length capped, control chars stripped, rendered as text only),
  speech bubbles, an emote wheel with 5 emotes and cooldown.
- **Saving**: all 5 triggers (60 s dirty autosave, logout, disconnect, SIGINT/SIGTERM/SIGHUP/SIGBREAK, immediately after
  character save). Each save runs in one transaction. "Saved ✓" toast. "Last saved" in Settings.
- **Backups**: SQLite online backup at start, every 6 h and via `npm run backup`. Newest 14 kept.
- **Scripts**: `npm run seed` (tester1–4 / test123), `npm run sim` (stub until Phase 3), `npm run e2e`.

## Decisions

Simple options picked where the spec was open, per CLAUDE.md:

1. **Map follows the real geography in the screenshots.** The Strand sits directly **north** of Dataran Sunway
   (adjacent, not "~1 km away"), and Mitraland sits between Jalan PJU 5/1 and the AH2 highway at the **map centre**.
   Gergasi Hypermarket is in the Mitraland block, which satisfies "Mitraland next to the hypermarket".
2. **Parody names**: Piramid Mall (Giza-style), Ayu Mall Damansara (the mall by Surian MRT), Sunrise Medical Centre,
   Gergasi Hypermarket, Lucky Strand Casino, IKEJA, Empayar Damansara, Ant Palms condos, Utama Greens golf,
   Bank Kota, Kedai Runcit Pak Abu.
3. **Highways are not walkable.** Streets that cross them act as underpasses, and there are pedestrian bridges
   (E31 → forest, AH2 at Menara Mitraland and up north).
4. **Port fallback**: if `PORT` isn't set and 3000 is busy, the server tries 3001, 3002… A port only counts as free if
   0.0.0.0, 127.0.0.1 and ::1 are all free, because another program held 127.0.0.1:3001 on this PC. If `PORT` *is* set,
   it's used exactly or the server exits with a clear message.
5. **Dev server = Express + Vite middleware on one port** (no separate 5173 proxy).
6. **The client sends positions, not raw inputs**: the server validates them with a movement budget
   (walk speed × 1.3, at most 0.6 s banked, +24 px slack) plus an L-shaped wall check. Simpler than input replay and
   tight enough for LAN.
7. **Session tokens are stored hashed (SHA-256).** The newest connection wins: a second tab or device with the same
   account kicks the older one.
8. **Editing your character is free in Phase 1** (Settings → Edit character). It becomes the paid Salon/Boutique
   (money sink) once money exists.
9. **Trees are not solid.** Canopies draw above characters, so you walk "under" them. Decor placement is a
   deterministic hash, so every device shows the same trees.
10. **Only the tables Phase 1 needs** (`accounts`, `sessions`, `players`, `schema_migrations`). Later phases add numbered migrations.
11. **Chat history is in memory** (last 50 messages, sent on join), not persisted.
12. **Keys**: **Tab** opens Settings for now (it becomes the HustlePhone in Phase 3). **Q** opens the emote wheel and
    **1–5** pick an emote. **E** near a door shows "interiors open in a later phase".
13. **Portrait is fully playable.** "Rotate to landscape" is a dismissable hint.
14. **Level badge shows 1 and titles are empty** until Phase 3. The volume/particles settings are saved but there's no audio yet (Phase 8 sound pass).
15. **Usernames**: 3–16 chars `[A-Za-z0-9_]`, unique case-insensitively.
16. **`?profile=<name>` URL param** keeps a separate login per tab (testing convenience).

## Known issues / limitations

- **Dev only:** when `tsx watch` restarts the server after a code change on Windows, the process is killed without the
  graceful handler, so up to 60 s of movement can be lost. Ctrl+C and production are fine.
- Graceful shutdown on Ctrl+C is implemented and unit-tested at the `saveAll` level, but sending a real Ctrl+C can't be
  automated here. Please do the Ctrl+C check in the list above.
- Character **side view** is the weakest angle (thin arms; tudung side view looks a bit boxy). Polish later.
- Client bundle is ~1.4 MB (Phaser, ~385 KB gzipped). Fine on LAN; can code-split later.
- No building interiors yet (separate scenes come with shops/Airbnb in later phases). `scene` is already stored per player.
- Headless test browsers run Phaser at a low frame rate, so e2e movement checks use loose thresholds.

## Next: Phase 2 (money, jobs and the gacha core)

Wallet in sen with short format (`formatMoney` already exists in `shared/src/format/money.ts`), Jobs Board (delivery + car wash),
rarities, luck math in `shared/luck.ts` with tests, 3 crates (Capsule, Lucky Bag, Mall Mystery Box), the reel and reveals,
inventory, equipping cosmetics, variants, pity, announcements, Item Index, Kedai Pajak, shards.
