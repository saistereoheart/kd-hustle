# Kota Hustle

A browser-based **LAN multiplayer 2D social RNG tycoon** set in a cartoon city inspired by Kota Damansara, Malaysia.
Hustle from RM 300 to billions with 2–5 friends on the same WiFi: roll crates for rare cosmetics, cook at your own
pasar malam stall, buy and decorate Airbnbs, run businesses, take loans (maybe from Ah Long…), race superbikes,
send your Teman into a cave, and flex on everyone.

**Version 1.0.** Every phase of [`docs/GAME_SPEC.md`](docs/GAME_SPEC.md) is built. What changed, round by round, is
in [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`CHANGELOG.md`](CHANGELOG.md).

## What's in the game
- **The town:** a real-scale Kota Damansara from **OpenStreetMap** (2 m per tile): The Strand, Dataran Sunway,
  Mitraland, Surian MRT, PJU 3. Real roads and building footprints, day and night, NPCs, signposts, a minimap and
  a full map, 🛵 Ronda rides.
- **Your character:** a chibi vector character creator (face shapes, 23 hairstyles, tudung styles, baju kurung /
  baju melayu…), cosmetics everyone sees, titles over your head, emotes, chat with speech bubbles.
- **Making money:**
  - starter jobs: delivery, car wash, Flyer Run, Mamak Helper;
  - food stalls from pasar malam to food truck to a kopitiam shoplot, with step-by-step cooking mini-games
    (6 recipes), staff, head chefs and cashiers;
  - 12 property types to rent out or run as an Airbnb, with a Sims-style decorate mode, 88 furniture pieces and
    a star rating;
  - idle businesses (Ventures), your own shop and Butik, Bank Kota loans or Ah Long.
- **Luck:**
  - 10 crates from the Capsule Machine to the Tan Sri Diamond Vault (visible odds, pity, variants, serial numbers);
  - 230 items in the Item Index;
  - the Lucky Strand Casino (7 games, shared tables), PvP coinflip.
- **With friends:** trading, gifting, Pasar Online (fixed price and auctions), leaderboards, server events
  (Lucky Hour, Rush Hour, Durian Season…), a shared radio, a night-skip vote.
- **🐾 Teman and ⚔️ Gua Gelap:**
  - 10 pets to buy, roll, train, upgrade and kit out with gear;
  - a turn-based cave battler with ultimates, bosses, rest rooms, Auto and Skip, and its own fight and boss music.
- **🚗 Motor Kota:**
  - 4 cars and 4 superbikes (parody names);
  - a real gearbox (automatic or manual), engine tuning, torque, tyres, paint, wheels and 4 exhausts;
  - engine sounds built from each engine's firing order, heard by nearby players;
  - a big dashboard and tyre smoke.
- **Progression:**
  - XP and levels to 100, 6 wealth stages from Budak Baru to Tan Sri, 45 titles;
  - 🏅 74 achievements, daily and weekly quests, a login streak, the Hustle Path for new players;
  - Hustle Skills, potions, and rebirth with a Rebirth Shop.
- **📱 HustlePhone:** every app in one place (P or Tab).
- **Sound:** made in the browser: effects, lofi music, battle music, engines, and city, casino and kitchen
  ambience.

All money is virtual. There are no real-money purchases.

## Requirements
- Node.js LTS (https://nodejs.org), v20 or newer
- One PC to host the server (Windows, macOS or Linux). Players join from any browser on the same network, phone
  or computer.

## Run it
```bash
npm install
npm run build
npm start          # production: the server also serves the game
# or, while developing:
npm run dev        # server + client with hot reload on one port
```
The server prints the address to open, e.g. `Players join at: http://192.168.1.23:3000`. Open it on any phone or
laptop on the same WiFi. If port 3000 is busy, the server picks the next free port and prints it. To force a port,
copy `.env.example` to `.env` and set `PORT`.

**Phones can't connect?** Allow Node.js through Windows Firewall on **Private** networks, make sure everyone is on
the same network, and check that the router doesn't have AP/client isolation turned on.

**Saving:** progress autosaves every 60 s, and on logout, on disconnect and when you stop the server with Ctrl+C.
`npm run backup` copies the database to `server/backups/` with a timestamp.

### Friends on a different WiFi (ZeroTier)
[ZeroTier](https://www.zerotier.com) makes a private virtual LAN over the internet, so the game still works as "LAN".
Nothing is opened to the public internet, and only devices you approve can reach the server.
1. **Host:** install ZeroTier One on the PC and create a free network at my.zerotier.com (keep it **Private**).
   Join it from the PC with the 16-character network ID.
2. **Players:** install the ZeroTier app (Windows, macOS, Android, iOS), join the same network ID, and turn the
   VPN toggle on.
3. **Host:** on my.zerotier.com, tick **Auth** next to each new member.
4. Start the server. It prints a `Remote players:` line with the PC's ZeroTier address
   (e.g. `http://10.147.17.5:3000`). Players open that address.
5. Windows may mark the ZeroTier adapter as a **Public** network, which the firewall rule for Node.js (Private only) blocks.
   Fix it once in an admin PowerShell: `Get-NetConnectionProfile`, find the ZeroTier entry, then
   `Set-NetConnectionProfile -InterfaceAlias "<that name>" -NetworkCategory Private`.

Tailscale works the same way, and its addresses (100.x.y.z) are also printed as `Remote players:`.
Never port-forward the game on your router: accounts and the server aren't hardened for the open internet.

## Controls
| | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD / arrows | joystick (bottom left) |
| Interact | E | the E button |
| HustlePhone | P or Tab | 📱 button |
| Bag / Map / Chat | B / M / Enter | buttons on screen |
| Hotbar (rides, potions…) | 1–0 | tap a slot |
| Emotes | Q | 😀 button |
| Gears (manual) | R up, F down, G auto/manual | ▲ ▼ A/M on the dashboard |

## Admin
The first account to register is the admin (or set `ADMIN_USERNAME` in `.env`). Admins have chat commands
(`/give`, `/event`, `/announce`, `/kick`, `/saveall`, `/reloadconfig`, `/music rescan`…) and a debug overlay.
From a terminal: `npm run admin -- list`, `promote <user>`, `demote <user>`, `password <user> [new]` (reset a
forgotten password) and `feedback [all]` (read the 🐞 reports players sent with the in-game Report button).

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Server + client with hot reload on one port |
| `npm run build` / `npm start` | Production build / run it |
| `npm run typecheck` | TypeScript checks for every workspace |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Browser tests with two players (Playwright, a throwaway DB). First time: `npx playwright install chromium` |
| `npm run backup` | Copy the DB to `server/backups/` with a timestamp |
| `npm run seed` | Create test accounts `tester1`–`tester4` (password `test123`) |
| `npm run admin -- <cmd>` | Accounts and admins (see above) |
| `npm run sim` | Economy balance simulator: time to each wealth stage vs the pacing targets (`-- --hours=30 --runs=10`) |
| `npm run sim:stall` | A pasar malam night: perfect vs sloppy cooking vs a hired cook |
| `npm run fetch-osm` / `npm run import-map` | Refresh the map from OpenStreetMap (see `shared/map/README.md`) |
| `npm run map-preview` / `npm run map-inspect` | Pictures of the collision grid / the built map, for map editing |

## Tweaking the game
All balance and content live in JSON in `shared/config/` (prices, odds, crates, items, recipes, properties,
businesses, loans, titles, achievements, quests, pets, the dungeon, cars and bikes…). The town layout overrides
and parody names are in `shared/map/town.overrides.json`. Restart the server after editing (admins can also type
`/reloadconfig` for most balance files).

## Project layout
```
client/   Phaser 3 + Vite game client (scenes, art drawn in code, DOM UI)
server/   Express + Socket.IO + SQLite (auth, game systems, saving, backups)
shared/   Types, zod schemas, config JSON (balance), the town map + collision
scripts/  backup, seed, admin, balance simulators, map tools
e2e/      Playwright browser tests
docs/     Spec, progress log, credits
```

## Music (the shared radio)
Everyone hears the same track at the same time; a majority vote skips it or switches the genre (📱 → 📻 Radio).
The music is **your own files on the server PC**, never in this repo:

```
server/music/
  lofi/      Artist - Title.mp3   (one folder per genre; any name)
  chill/     ...
  dangdut/   ...
```

File names like `Artist - Title.mp3` show as "Title · Artist". MP3, OGG, M4A, WAV, FLAC and Opus work. Add files
while the server runs and type `/music rescan` in chat (admin). Use music you're allowed to share, e.g. FreePD.com
(public domain), OpenGameArt.org (CC0), Pixabay Music, Incompetech (CC-BY: credit the artist). Set `MUSIC_DIR` to
use another folder.

## Map data
Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.
The generated map files in `shared/map/` are ODbL; the code is MIT.

## Disclaimer
All in-game money is virtual and has no real-world value. There are no real-money purchases.
Real place names are used for inspiration only; all shops, brands, cars and bikes in the game are fictional parodies.

## License
Code: MIT. See [LICENSE](LICENSE). Map data: ODbL (see above). Third-party licences: [`docs/CREDITS.md`](docs/CREDITS.md).
