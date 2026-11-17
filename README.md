# Kota Hustle

A browser-based **LAN multiplayer 2D social RNG tycoon** set in a cartoon city inspired by Kota Damansara, Malaysia.
Hustle from RM 300 to billions: roll crates for rare cosmetics and items, cook at your own pasar malam stall,
buy and decorate Airbnbs, run businesses, take loans (maybe from Ah Long…), and flex on friends on the same WiFi.

> 🚧 Work in progress: **Phases 1, 1.5 and 2 are done** (town, characters, money, jobs, crates). See [`docs/PROGRESS.md`](docs/PROGRESS.md) for status,
> decisions and a step-by-step test guide.

## What works now (Phase 1)
- Accounts (register / login / auto-login / one session per account) with autosave
- A chibi vector character creator: face shapes, 23 hairstyles, tudung styles, baju kurung / baju melayu and more
- A real-scale Kota Damansara built from **OpenStreetMap** (2 m per tile, ~1.5 × 1.15 km): The Strand, Dataran
  Sunway, Mitraland, Surian MRT, PJU 3 / Palm Spring, with real roads, lanes and building footprints
- Walk around with friends (keyboard or touch joystick), see each other in real time, chat with speech bubbles, emotes
- Minimap + full map, district banners, saving (autosave every 60 s, on logout/disconnect/shutdown) and DB backups
- Money in RM, two starter jobs (food delivery on a kapcai motorbike, car wash), 3 gacha crates with visible odds,
  a CS:GO-style reel, 48 collectable items, cosmetics everyone can see, pity, rare-pull announcements, Item Index,
  pawn shop and Shard Shop

## Features (planned)
- More crates (up to the Tan Sri Diamond Vault), luck upgrades and potions, levels, titles and quests
- Step-by-step cooking mini-games (Nasi Lemak, Teh Tarik, Roti Canai…) or passive income with staff
- Buy property: long-term rent or Airbnb with a Sims-style decorate mode and a star rating
- Shops, businesses, bank loans, a casino, trading, a marketplace, titles, levels and rebirth

Full design: [`docs/GAME_SPEC.md`](docs/GAME_SPEC.md)

## Requirements
- Node.js LTS (https://nodejs.org), v20 or newer
- A PC to host the server. Players join from any browser on the same network.

## Run it
```bash
npm install
npm run dev        # development (hot reload, one port)
# or
npm run build
npm start          # production
```
The server prints the address to open, e.g. `Players join at: http://192.168.1.23:3000`. Open it on any phone or
laptop on the same WiFi. If port 3000 is already used by another program, the server picks the next free port and
prints it. To force a port, copy `.env.example` to `.env` and set `PORT`.

If other devices can't connect: allow Node.js through Windows Firewall (Private networks), make sure they're on the
same network, and check that your router doesn't have AP/client isolation turned on.

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

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Server + client with hot reload on one port |
| `npm run build` / `npm start` | Production build / run it |
| `npm run typecheck` | TypeScript checks for every workspace |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Browser smoke test with two players (Playwright, uses a throwaway DB). First time: `npx playwright install chromium` |
| `npm run backup` | Copy the DB to `server/backups/` with a timestamp |
| `npm run seed` | Create test accounts `tester1`–`tester4` (password `test123`) |
| `npm run admin -- list` | List accounts and admins. Also `promote <user>`, `demote <user>`, `password <user> [new]` (reset a forgotten password) |
| `npm run sim` | Economy balance simulator (arrives in Phase 3) |
| `npm run fetch-osm` / `npm run import-map` | Refresh map data from OpenStreetMap (see `shared/map/README.md`) |
| `npm run map-preview` | PNG of the collision grid, for map editing |

## Project layout
```
client/   Phaser 3 + Vite game client (scenes, character renderer, DOM UI)
server/   Express + Socket.IO + SQLite (auth, game systems, saving, backups)
shared/   Types, zod schemas, config JSON (balance), the town map + collision
scripts/  backup, seed, balance simulator
e2e/      Playwright smoke test
docs/     Spec, progress log, credits
```
Balance and content live in `shared/config/*.json`, and the town layout lives in `shared/map/town.json`.
Restart the server after editing them.

## Map data
Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.
The generated map files in `shared/map/` are ODbL; the code is MIT.

## Disclaimer
All in-game money is virtual and has no real-world value. There are no real-money purchases.
Real place names are used for inspiration only; all shops and brands in the game are fictional parodies.

## License
Code: MIT. See [LICENSE](LICENSE). Map data: ODbL (see above). Third-party licences: [`docs/CREDITS.md`](docs/CREDITS.md).
