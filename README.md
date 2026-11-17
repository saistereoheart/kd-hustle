# Kota Hustle

A browser-based **LAN multiplayer 2D social RNG tycoon** set in a cartoon city inspired by Kota Damansara, Malaysia.
Hustle from RM 300 to billions: roll crates for rare cosmetics and items, cook at your own pasar malam stall,
buy and decorate Airbnbs, run businesses, take loans (maybe from Ah Long…), and flex on friends on the same WiFi.

> 🚧 Work in progress: **Phase 1 (foundation) is done.** See [`docs/PROGRESS.md`](docs/PROGRESS.md) for status,
> decisions and a step-by-step test guide.

## What works now (Phase 1)
- Accounts (register / login / auto-login / one session per account) with autosave
- A chibi vector character creator: face shapes, 23 hairstyles, tudung styles, baju kurung / baju melayu and more
- A big 256×192-tile town centred on Menara Mitraland: Dataran Sunway, The Strand, Mitraland & The Cascades,
  Surian MRT, PJU 3, Rymba Hills, the Community Forest Reserve…
- Walk around with friends (keyboard or touch joystick), see each other in real time, chat with speech bubbles, emotes
- Minimap + full map, district banners, saving (autosave every 60 s, on logout/disconnect/shutdown) and DB backups

## Features (planned)
- Gacha crates with 8 rarity tiers, variants, luck upgrades, pity and server-wide rare-pull announcements
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
| `npm run sim` | Economy balance simulator (arrives in Phase 3) |

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

## Disclaimer
All in-game money is virtual and has no real-world value. There are no real-money purchases.
Real place names are used for inspiration only; all shops and brands in the game are fictional parodies.

## License
MIT. See [LICENSE](LICENSE). Third-party licences: [`docs/CREDITS.md`](docs/CREDITS.md).
