# Kota Hustle: Progress

_Last updated: 2026-11-17_

## Status

**Phase 1 (Foundation): done.** **Phase 1.5 (real-scale OSM map + character polish): done.**
**Phase 2 (money, jobs and the gacha core): done.** Phase 3 (progression: XP, levels, titles, Hustle Skills, potions,
daily quests, HustlePhone, balance simulator) is next.

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean (shared, server, client, scripts) |
| `npm test` (Vitest) | ✅ 72 unit tests (luck/odds incl. a 300k-roll statistical check, pity, purchases, rollback, pawn, shards, job pay + anti-cheat, map + polygon collision, emotes) |
| `npm run e2e` (Playwright: desktop + phone) | ✅ Phase 1 + Phase 2 specs pass (incl. manifest earning + skill upgrade) |
| Server boots, binds `0.0.0.0` and prints the LAN URL | ✅ |
| Real phone on the LAN | ⏳ needs you (see below) |

---

## Phase 2.2 (in progress): second feedback round

**State: WIP commit (local only, not pushed).** All code is written and `npm run typecheck` is clean. The unit test run
was interrupted, so `npm test` and `npm run e2e` have NOT been run on this commit yet.

| Request | Status |
|---|---|
| Full map closes on click outside; **M** toggles it (minimap toggle moved to **N**) | done, untested |
| Character hidden north of a line across the map | **fixed**: characters drew under the ground when world y < −1000 px (north of Menara Mitraland). Avatars now draw at depth 500 000 + y |
| Slide along angled walls instead of stopping | done + unit-tested (map tests); the server path check also accepts straight diagonal slides |
| Manifest 2× base | `baseSenPerSec` 1 → 2 (RM 0.02/s at Lv 1, +RM 0.01/s per level). Stops while riding |
| Sharper map + characters on phones | the game canvas now renders at device pixel ratio (up to 3×, capped at ~8.3 MP); map chunks at up to 2.5× |
| Harder car wash, at a car wash | new **Kilat Car Wash** (−199, 117.5, ~60 m east of the Jobs Board). 3 stages graded on the server: 🧽 soap (3 stubborn bird-dropping spots need 14 scrubs), 🚿 rinse a 8×3 grid, ✨ polish timed shine marks. 55 s, pays up to RM 58.50 at Lv 1. Unit-tested |
| Delivery doesn't spawn a motorbike; order it from the phone | done: 📱 **Phone (P / HUD button)** → order a 🛵 kapcai for RM 8 (rented until you hop off; returned on disconnect). Delivery time budget now assumes the bicycle |
| Everyone starts with a bicycle | 🚲 Basikal (290 px/s, walk grid: sidewalks/paths yes, highways no), in hotbar slot 1 by default |
| Hotbar 1–0 | done: 10 slots, bottom centre (above the joystick on phones held upright). Vehicles hop on/off; cosmetics wear/take off. Bag → item → "Add to hotbar"; right-click / long-press clears. Saved in `players.hotbar_json` (migration 5). **Number keys now use the hotbar; emotes use Q then a number, − is still Manifest** |
| Chat middle-left, larger | done (15 px text, 440 px wide on desktop) |

**Next steps**
1. `npm test`: confirm the new car wash grading tests, wall-slide tests and the updated map test.
2. Update e2e: `phase1.spec.ts` (press Q before `5` for the flex emote) and `phase2.spec.ts` (carwash: `/tp -199 117`, then
   play the 3 stages using `k.job()` data; delivery: no motorbike on start, order it via `[data-action=order-motorbike]`
   in the phone panel; check hotbar key `1` mounts the bicycle).
3. Play-test on PC + phone: hotbar layout at 390×844, chat position, car wash difficulty, phone sharpness.
4. Then update this file (move the table into "What changed"), commit.

## Phase 2.1: feedback fixes (map zoom, collision, Manifest, jobs board)

### How to test it
1. **Zoomable full map:** press **M** or tap the minimap. Use the mouse wheel, double-click, pinch, or the **+ / −**
   buttons; drag to pan; **📍** recentres on you. Street names appear once you zoom in past about 2×.
2. **North half no longer blocked:** walk north from Kota Bazaar towards The Strand. You can now cross where the
   DASH ramps run (see Decisions). If you still hit an invisible wall, tell me roughly where (a screenshot of the full
   map with the 📍 helps). Admins can jump around with `/tp <x> <y>` (tile coordinates).
3. **Smooth angled walls:** walk along a slanted building (e.g. the Strand Mall or the angled Mitraland blocks). You slide
   along the real edge instead of catching on a staircase.
4. **🧘 Manifest emote:** press **−** (the key after 0) or pick 🧘 on the emote wheel. Sit still: you earn
   **RM 0.01 per second** at Lv 1 (a small "+RM" floats up every second; the wallet updates every 10 s). Moving stops it.
5. **Bag → Skills tab:** upgrade Manifesting. Lv 2 costs RM 50 and doubles the rate; each level adds +RM 0.01/s, up to Lv 25.
6. **Jobs Board:** the job cards now show full-width text with the button beside it (or below on phones).

### What changed
- **Full map** (`client/src/ui/minimap.ts`): zoom/pan with wheel, buttons, double-click and pinch. Labels scale with zoom
  (districts → named buildings → streets → interactables).
- **Exact building collision** (`shared/src/map/collision.ts`): buildings block by their real OSM polygon (segment-vs-hitbox
  test through a spatial index), not by 2 m tiles. Water and highways still use tiles. Both server and client use the same
  code, so they agree.
- **Manifest** (`shared/config/skills.json`, `server/src/game/economyHandlers.ts`): server-timed. The server banks sen each
  second while you hold the emote and aren't moving, then pays it out every 10 s, when you stop, and on disconnect. Every
  payout is logged in `transactions` (reason `manifest`). The skill level is saved in `players.skills_json` (migration 4).
- **Jobs Board card layout** fixed (the button no longer squeezes the text into a 5-letter column).
- **Grass blotches** are placed on a world grid, so chunk edges no longer show faint square "boxes".
- **Admin `/tp <x> <y>`** (tile coordinates) for testing.
- **`npm run admin`**: list admins, promote/demote, reset a forgotten password.
- **Remote play:** the server labels ZeroTier/Tailscale addresses `Remote players:`. Setup steps are in the README
  ("Friends on a different WiFi").

---

## Phase 2: money, jobs and the gacha core

### How to test it (PC + phone)
1. `npm run dev`, then open the printed URL on the PC and the phone (see "How to test Phase 1" below for firewall/WiFi).
2. You spawn on the Dataran Sunway sidewalk with **RM 300**, shown under your name (tap it for the exact amount).
   Next to you are the **📋 Jobs Board**, **🎰 Capsule Machine** (Kedai Runcit), **🏪 Kedai Pajak Untung** (pawn shop),
   and across the lane the **🧧 Lucky Bag Stall**. The **🎁 Mall Mystery Box** is at Piramid Mall (south, ~200 m).
   Stand near one and press **E** (or the E button on the phone).
3. **Roll crates:** the panel shows every tier's chance and "1 in X", the pity counters and the item pool
   (silhouettes until found). Try ×1 (the reel) and ×5/×10 (the flip grid). Skip with the button.
4. **🎒 Bag (B):** tap an item and press **Wear** (hats, glasses, auras, wings/capes, name colours). The other device
   should see it on your character. The **Item Index** tab shows your collection; completing a crate's page pays
   50× its price (Capsule: RM 1,000).
5. **Kedai Pajak:** sell items (50% of value), scrap them into 💎 shards, or buy items you've discovered in the Shard Shop.
6. **Jobs Board → Car Wash:** drag over every brown dirt spot before time runs out (mouse or finger).
7. **Jobs Board → Delivery:** you hop on a kapcai. Follow the yellow arrow and marker to the shop (pickup is automatic
   when you arrive), then to the home before the timer runs out for a tip. Roads are fast, grass is slow, highways are
   rideable. Your friend sees you on the bike.
8. **Admin test commands** (the first registered account is admin): in chat type
   `/give me money 100000`, `/give me item halo rainbow`, `/give <name> shards 500`.
   Use these to try the Mall Mystery Box and to see a **Legendary+ announcement** banner (Divine/Secret get a
   fireworks takeover for everyone).
9. Refresh: money, items, what you're wearing and pity counters are all kept (they're saved instantly on the server).

### What was built
- **Wallet** in integer sen, short format on the HUD, floating "+RM" on earnings. Every change is logged in a
  `transactions` table inside one SQLite transaction; the in-memory player rolls back too if anything fails.
- **Rarities + luck** (`shared/src/luck.ts`): 8 tiers at the spec's odds, luck multiplies Rare+ then renormalises,
  sources multiply within a type and add across types, capped at 50×. Variants Shiny 1/20, Golden 1/100,
  Rainbow 1/1000. Limited items get serial numbers ("Durian King Crown #2 of 5"; Tan Sri's Songkok is 1 of 1).
- **3 crates** (`shared/config/crates.json`): Capsule Machine RM 20, Lucky Bag RM 150, Mall Mystery Box RM 1,500;
  ×1/×5/×10; pity (Epic+ every 50, Legendary+ every 300; Mall box 40/250). Rolls use `crypto.randomInt` on the
  server and only work when you're standing at the machine. Every roll is in `roll_log`; Legendary+ also in the server log.
- **48 items** (`shared/config/items.json`), all drawn in code: 17 hats, 5 face items, 6 auras (particle effects),
  6 back items (wings, cape, jetpack, backpack), 3 name colours, plus trinkets, furniture and boosters
  (usable in later phases).
- **The roll experience:** CS:GO reel with near misses and ticks, ×10 flip grid, rarity reveals (pop → purple flash
  → gold burst + screen shake → Mythic+ darkened slow-mo with light rays), WebAudio sounds, server-wide banners,
  and the Divine/Secret fireworks takeover.
- **Equipping** (hat, face, aura, back, name colour) is visible to everyone; Golden/Rainbow/Shiny change the look.
- **Item Index** with page rewards, **Kedai Pajak** (sell/scrap), **Shard Shop**.
- **Jobs:** Delivery Rider (real shop door → real home door, distance-based pay, time tips, the **first driveable
  vehicle**) and Car Wash Helper (server grades your raw strokes). Job levels raise pay by 8%/level.
- **Vehicles:** the server checks bike speed against a separate "drivable" collision grid (highways yes,
  buildings/water no). Flyovers are drivable; the client applies terrain speed (road 1.0×, grass 0.4×…).
- **Admin `/give`** (spec §17) for testing.

---

## Phase 1.5: what changed (and what to check)

### Real-scale map from OpenStreetMap
- The map is now built from **OpenStreetMap** at **2 m per tile**: **768 × 576 tiles ≈ 1.5 × 1.15 km**, covering
  The Strand, Dataran Sunway, Mitraland, Surian MRT / Ayu Mall, PJU 3 / Palm Spring, Taman Kota and Gugusan Dedap.
  The 2× map (512×384) would have cut off Surian MRT, so I went with your 3× size straight away.
- **Real roads:** lane counts from OSM (3.5 m lanes), sidewalks, lane markings (dashed lanes, centre lines), zebra
  crossings, street-name labels, underpasses and the Persiaran Surian bridge over the NKVE, the DASH and the elevated MRT.
- **Real buildings:** 714 OSM footprints (polygons) with roof colours, shadows scaled by height, south-facing facades
  with windows, rooftop AC units and skylights, and doors facing the street.
- **Fixed world origin = Menara Mitraland (tile 0,0).** Growing the map later only extends the bounds. Positions,
  building ids (= OSM ids) and future property ownership never move.
- **Terrain speeds** (`shared/config/terrain.json`) are ready for vehicles: road 1.0×, grass 0.4×, forest 0.25×,
  highway drive-only, buildings and water blocked.
- **Map data licence:** ODbL, with "© OpenStreetMap contributors" shown in-game (bottom-right and on the full map).
- Rendering is chunked (512 px pieces drawn on demand near the camera, old ones freed), so phones only hold what's nearby.

**Check:** walk from Dataran Sunway (spawn) to Menara Mitraland, across the bridge to PJU 3, and down to Surian MRT.
The full map (🗺️) shows the whole area with district names.

### Character polish (chibi, more detailed)
- **Hats are sized to the hair** and the hair under them is flattened: no more spikes, buns or quiffs poking through
  caps, beanies or songkok. Fringe, side hair, tails and braids still show.
- **Hair:** gradient shading, strand lines, shine highlight, and side locks that frame the face and cover the ears
  (this fixes the ear clipping).
- **Face/clothes:** soft shading, chin shadow, ear detail, upper eyelid lines, shading on tops.
- **Tudung side view:** a rounded face opening instead of the boxy look.

**Check:** ⚙️ Settings → Edit character, then try caps/beanie/songkok over spiky, afro, bun and long hair, and rotate the preview.

### Emotes v2 (detailed, spammable, continuous)
- **10 emotes, 4 animation frames each:** 👋 Wave, 💃 Dance ↻, 😂 Laugh, 😭 Cry ↻, 💪 Flex, 👏 Clap, 🎉 Cheer (jump),
  🤲 Salam, 🪑 Sit ↻, 💤 Sleep ↻.
- **Effects:** music notes (dance), falling tears (cry), Zzz (sleep), confetti (cheer), sparkles (flex, salam),
  clap burst, "HA HA", "Hi!". They respect ⚙️ Settings → Particles.
- **Spammable:** no cooldown, just a burst limit of 6 per 2 s (`chat.json → emoteRateLimit`). Spamming restarts the
  animation and fires new effects.
- **Continuous (↻):** dance, cry, sit and sleep loop until you walk, tap the same emote again, or pick another.
  The server remembers them, so players who join later still see you sitting or sleeping.
- **Controls:** keys **1–9, 0** fire emotes directly (no wheel needed). **Q** / 😀 toggles the wheel, which now
  stays open and doesn't block the screen, so you can keep tapping and walking. ✕ closes it.

**Check:** on the phone, open 😀 and tap Clap repeatedly, then Sit. Your friend should see you sitting, still see it
after they refresh, and see you stand up when you walk.

### One-time note
Accounts created before this update had positions on the old map, so they **spawn in Dataran Sunway once** on their
next login (the server logs `Placed <name> at a safe spot (map-version)`). Characters and accounts are kept.

### Map maintenance (optional, only if you want fresh OSM data)
```bash
npm run fetch-osm     # downloads OSM tiles into data-src/ (git-ignored, ~5 MB)
npm run import-map    # regenerates shared/map/kd.osm.json
npm run map-preview   # writes test-results/map-preview.png (the collision grid) to eyeball changes
npm test              # the map validator must stay green
```
Landmark parody names, districts and spawn live in `shared/map/town.overrides.json` (see `shared/map/README.md`).

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
- [ ] **Emotes:** press **1–9, 0** (or tap 😀). One-shots can be spammed; ↻ ones (dance, cry, sit, sleep) loop until you walk.
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

**Phase 2.1**
- **The "invisible box above Kota Bazaar"** was the DASH ramps and links. OSM doesn't tag these ground-level carriageway
  segments as bridges, so they counted as an unwalkable highway band across the north half. They are now listed under
  `elevate` in `shared/map/town.overrides.json`: treated as elevated, they don't block the ground. Extend that list if
  another one turns up.
- **Polygon collision only for buildings.** Highways and water stay tile-based for now (cheap, and they are wide, so the
  2 m steps matter less). Roof-only parts (`building:part=roof`, canopies) never block.
- **Manifest pays 1 sen/s at Lv 1, +1 sen/s per level, max Lv 25 (RM 0.25/s ≈ RM 900/hour).** Upgrade cost =
  RM 50 × 1.6^(level−1), so reaching Lv 25 costs ~RM 6.6M in total. It's a small idle trickle, not a main income. All values are
  in `skills.json`. It stops while you move or ride; AFK-farming is intended and will be tuned by the Phase 3 simulator.
- **Payout every 10 s** (not every second) to keep the DB transaction log small. The client shows a local "+RM" each
  second for feel; only the server's payout counts.
- **Skills tab lives in the Bag** for now; it moves into the HustlePhone's Hustle Skills tree in Phase 3.

**Phase 2**
- **Luck is ×1 for now.** The formula and its tests exist; the sources (upgrades, potions, titles, events, index
  rewards) arrive in Phase 3. **×5/×10 are available to everyone** until the Hustle Skills tree can unlock them.
- **Crate places:** Capsule Machine at Kedai Runcit Pak Abu, Lucky Bag at a pasar malam stall on the grass verge
  next to spawn (the real pasar malam comes with Phase 4), Mall Mystery Box at Piramid Mall.
  You must stand within 8 tiles (16 m) to roll; the server checks.
- **Spawn moved 4 tiles east** so the Jobs Board, Capsule Machine and pawn shop are all within reach.
- **Each item belongs to exactly one crate.** Tiers a crate has no items for show "not in this crate" (0%), so
  the advertised odds are exactly what can drop. Capsule has no Divine/Secret; Lucky Bag has no Secret.
- **Item value = crate price × rarity factor × variant multiplier** (`rarities.json`). The pawn shop pays 50%, so the
  expected pawn value of a roll is below its price (house edge; a unit test checks this for every crate).
- **Item Index page reward = 50× crate price** (luck and title rewards in Phase 3).
- **Shard Shop** sells only items you've discovered, Common to Epic, never limited ones. Limited (serial-numbered)
  items can't be pawned or scrapped (they're trophies; trading comes in Phase 7).
- **Money is saved instantly** in DB transactions (not by the 60 s autosave), so a crash never loses a roll or a sale.
- **The delivery motorbike only exists during a delivery** (owning vehicles comes later). Bike speed 430 px/s
  ≈ 27 m/s on roads. The timer starts at pickup; arriving early gives up to a 60% tip, late pays 70%.
  Destinations are only doors a bike can actually reach.
- **Announcements wait 4.2 s** so the roller's reel finishes before everyone else sees the banner.
- **Trinkets, furniture and boosters** can be collected, sold and scrapped now; they become usable in their phases
  (boosters in Phase 4 stalls, furniture in Phase 5 Airbnbs).
- **Pets, outfits and emote packs** from the spec's crate highlights are deferred (pets need follow AI) and will join
  the pools in later phases without changing the odds format.
- `KH_TEST_ALL_ADMIN=1` makes every account an admin. It's only set by the automated tests, never in normal runs.

**Phase 1.5**
- **3× map size now (768×576 tiles at 2 m)** instead of 2×: at real scale the 2× map couldn't fit Surian MRT and the
  south of Dataran Sunway.
- **Origin = the actual Menara Mitraland building** (OSM way 1030583397, 3.15494 N, 101.597374 E).
- **The Phase 1 hand-drawn map is retired.** Districts are now The Strand, Dataran Sunway, Mitraland, Surian MRT &
  Ayu Mall, Taman Kota, Gugusan Dedap, PJU 3 & Palm Spring. The forest reserve and Rymba Hills come with the next
  map expansion.
- **Parody landmarks on real buildings:** Piramid Mall, Ayu Mall Damansara, The Strand Mall, Lucky Strand Casino,
  Gergasi Hypermarket, Mitraland Podium, Sunrise Medical Centre, Bank Kota, Kedai Runcit Pak Abu, The Cascades,
  Ant Palms A–F, Kota Bazaar.
- **Elevated roads** (DASH, flyovers) don't block the ground. Where a flyover passes over a highway it becomes a
  walkable bridge. Underpasses are kept as ground roads.
- **Walking speed unchanged** (≈ a jog at real scale). Crossing the map on foot takes about 2.5 minutes, which is
  intended, so vehicles matter later.
- **Trees:** OSM has almost no tree data here, so trees are placed by a deterministic pattern in parks, grass and
  forest. Canopies are semi-transparent so players under them stay visible.
- **The spawn fountain is removed for now** (on the real map it landed on a road). It comes back with a proper plaza.
- **The client gets the map as ~225 KB of JSON (~55 KB gzipped)** and builds the grid itself (~100 ms), using the same code as the server.

**Phase 1**

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

- **Phase 2:** the economy isn't balanced yet. Phase 3's simulator will tune job pay and prices against the spec's
  pacing (Stage 2 in ~20 min). Right now a car wash pays ~RM 28–36 and a delivery ~RM 50–90.
- **Phase 2:** only the desktop and phone browser tests have exercised the reel and car wash. Please try the
  car wash with a finger on your phone and tell me if the dirt spots feel too small.
- **Phase 2:** a delivery that's in progress is cancelled if you disconnect (you get off the bike, no pay).

- **Phase 1.5:** chunk drawing is spread over frames (8 ms budget per frame), but on slow phones you may see the map
  fill in while walking fast. Tell me if it stutters and I'll move chunk drawing to a background worker.
- **Phase 1.5:** buildings cut off by the map edge have no door, and 7 inside the map have none because their OSM
  footprints overlap.
- **Phase 1.5:** characters are cartoon-sized compared with the real-scale roads (a person is about half a 2-lane road
  wide). This is intentional for the chibi style. Say if you want them smaller.

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
