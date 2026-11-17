# CLAUDE.md — Kota Hustle

This file is read at the start of every Claude Code session. Follow it strictly.

## What this project is
**Kota Hustle** is a browser-based, LAN multiplayer (2–5 players) 2D social RNG tycoon game.
One PC runs the server; players on the same WiFi join by opening `http://<server-LAN-IP>:3000`
on any phone, tablet or laptop. The town is a big modern-city map inspired by Kota Damansara
(Dataran Sunway, The Strand, Mitraland/The Cascades). Currency is **MYR (RM)**. Virtual money only.

The full design is in **`docs/GAME_SPEC.md`**. It is the source of truth. Read the relevant
sections before working on any feature. Progress is tracked in **`docs/PROGRESS.md`** (create it in Phase 1).

## Tech stack (do not change without asking)
- **Monorepo** with npm workspaces: `/client`, `/server`, `/shared`, `/scripts`, `/docs`
- **Language:** TypeScript everywhere (strict mode)
- **Client:** Phaser 3 + Vite. UI overlays (menus, inventory, editors) may use plain DOM/HTML+CSS on top of the canvas.
- **Server:** Node.js (LTS) + Express + Socket.IO
- **Database:** SQLite via `better-sqlite3` (WAL mode), file at `/server/data/game.db`
- **Auth:** username + password, `bcrypt` hashing, random session token stored in localStorage
- **Validation:** `zod` for every socket message and HTTP body
- **Balance/config:** JSON files in `/shared/config/` (items, crates, rarities, properties, businesses, recipes, upgrades, titles, levels, loans). No magic numbers in game logic.

## Non-negotiable rules
1. **Server-authoritative.** All rolls, odds, money, XP, purchases, trades, loans, cooking scores and timers are computed and validated on the server. The client only sends *intents* ("I want to roll crate X", "I pressed flip at t=1234ms") and renders results. Never trust client numbers.
2. **RNG on the server only**, using `crypto.randomInt` / a seeded server PRNG. Log every Legendary+ roll.
3. **Money is stored as integer sen** (1 RM = 100 sen) using JS `number` up to 2^53, or `BigInt` if a value can exceed ~RM 90 trillion. Display with short format: `RM 1,250` → `RM 12.5K` → `RM 3.4M` → `RM 1.2B` → `RM 5T`.
4. **Saving:** autosave dirty players every 60 s, save on logout, on socket disconnect, and on server shutdown (SIGINT/SIGTERM graceful handler). Never lose more than 60 s of progress.
5. **Config-driven balance.** Any price, odds, multiplier, cost curve or timer lives in `/shared/config/*.json` and is loaded at startup (hot-reload in dev is a bonus).
6. **Mobile + desktop.** Every screen must work with touch (virtual joystick, tap) and keyboard/mouse (WASD/arrows, E to interact). Test layouts at 390×844 and 1920×1080.
7. **Server binds to `0.0.0.0:3000`** and prints the LAN URL(s) on startup, e.g. `Players join at: http://192.168.1.23:3000`.
8. **Art is drawn in code** (Phaser Graphics / generated SVG → textures). Cartoon/vector, chibi proportions, not realistic. No copyrighted characters, logos or real brand names — use parody names (see spec).

## How to work
- Build **one phase at a time** (phases are in `docs/GAME_SPEC.md` §20). Don't start the next phase until the current one's acceptance checks pass.
- At the start of each phase: read the spec sections, write a short plan, then implement.
- Keep files small and modular: one system per folder (e.g. `server/src/systems/gacha/`, `server/src/systems/airbnb/`).
- Shared types and config schemas live in `/shared` and are imported by both client and server.
- After each phase: run the game, fix errors, run `npm run typecheck` and tests, update `docs/PROGRESS.md` (what's done, what's next, known bugs), and make a git commit.
- If a spec detail is unclear, pick the simplest reasonable option, note it in `docs/PROGRESS.md` under "Decisions", and continue.
- Write unit tests for the money-critical logic: rolls/odds, luck math, purchases, loans, trades, offline income.

## Commands (create these in Phase 1)
- `npm install` — install all workspaces
- `npm run dev` — run server + client with hot reload (client proxied through server on port 3000 so phones can join in dev too)
- `npm run build` then `npm start` — production build; server serves the built client
- `npm run typecheck`, `npm test`
- `npm run sim` — run the economy balance simulator (`/scripts/balance-sim.ts`)
- `npm run backup` — copy the DB to `/server/backups/` with a timestamp

## This repo is PUBLIC on GitHub
- Never commit secrets, `.env`, the SQLite DB, backups, player data or logs (all in `.gitignore`; keep it that way).
- Provide a `.env.example` with placeholder values for any setting that needs one (e.g. `ADMIN_USERNAME`, `PORT`).
- Don't commit anything from `docs/reference/` (Google Maps screenshots can't be redistributed).
- Only use assets (sounds, fonts) that are CC0 / MIT / OFL or generated in code; note the licences in `docs/CREDITS.md`.
- Never hardcode the host's LAN IP, file paths or usernames.
- Keep `README.md` up to date with how to run it.

## Environment notes
- Host is a Windows 10/11 PC. Use cross-platform scripts (no bash-only commands in npm scripts; use `cross-env`, `concurrently`, etc.).
- Windows Firewall must allow Node.js on Private networks. Remind the user if phones can't connect.
