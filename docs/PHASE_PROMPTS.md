# Prompts to paste into Claude Code

Paste these one at a time into the Claude Code panel in VS Code.
**Tip:** switch Claude Code to **Plan mode** before each phase prompt. Read the plan, say "go" (or ask for changes),
then let it build. Start a fresh conversation (`/clear`) between phases. CLAUDE.md and the spec keep the context.

---

## −1. Environment check (run this first on a new machine)

```
Check this Windows machine is ready to build the project in CLAUDE.md. Run and report:
node -v, npm -v, git --version, gh --version, git config user.name, git config user.email,
and whether `git status` works in this folder. Node must be the current LTS. Tell me what's
missing or outdated and the exact winget command to fix each one. Don't install anything
without asking me first.
```

## 0. Kickoff (first message ever)

```
Read CLAUDE.md and docs/GAME_SPEC.md fully. This is a browser-based LAN multiplayer
2D social RNG tycoon game called Kota Hustle.

Before writing code:
1. Summarise the game back to me in 10 bullet points so I know you understood it.
2. List any risks or questions about the spec (keep it short).
3. Propose the exact folder structure and the npm packages you'll use.
4. Write a plan for Phase 1 only (spec §20).

Then wait for my "go" before implementing.
```

## Phase 1 — Foundation

```
Implement Phase 1 from docs/GAME_SPEC.md §20 (Foundation), following CLAUDE.md.
Key parts: monorepo + npm scripts, server on 0.0.0.0:3000 printing the LAN URL,
register/login/session tokens with bcrypt, the vector chibi character creator (§4 — all
categories), the big map (§5) with districts blocked out using simple shapes and labels,
movement + collision + camera + minimap, multiplayer presence with interpolation,
chat + speech bubbles + emote wheel, and saving with all 5 triggers + backups (§3).
If docs/reference/ has map screenshots, use them to approximate road and block layout.
Create docs/PROGRESS.md. When done, run it, fix errors, tell me exactly how to test it
on two devices, then commit.
```

## Phase 2 — Money, jobs and gacha core

```
Read docs/PROGRESS.md, then implement Phase 2 from docs/GAME_SPEC.md §20, using §6–§7.
Focus on making the roll feel amazing: the CS:GO-style reel, rarity-based reveals,
screen shake, server-wide announcements. Put the luck formula in shared/luck.ts with
unit tests. All odds visible to players and all rolls on the server. Update PROGRESS.md and commit.
```

## Phase 3 — Progression

```
Read docs/PROGRESS.md, then implement Phase 3 (§11, §12, §15, §16 HustlePhone, §17 simulator v1).
After building, run `npm run sim` and show me the time-to-stage table vs the pacing targets
in §6. Suggest config changes if it's off. Update PROGRESS.md and commit.
```

## Phase 4 — Food stalls and cooking

```
Read docs/PROGRESS.md, then implement Phase 4 (§8.2). Build Nasi Lemak, Teh Tarik and
Roti Canai as step-by-step mini-games that work with touch and keyboard. The server sends
the mini-game seed and timing windows and grades the inputs. Add NPC customers with queues,
the day/night cycle, and the pasar malam opening at night. Update PROGRESS.md and commit.
```

## Phase 5 — Property and Airbnb

```
Read docs/PROGRESS.md, then implement Phase 5 (§8.3, §8.7, §9). The decorate mode and star
rating engine are the heart of this phase: grid editor with undo/redo, theme set bonuses,
the suggestions panel with predicted ★ and RM gains, pricing/occupancy simulation, guest
NPCs and reviews. Unit-test the star rating. Update PROGRESS.md and commit.
```

## Phase 6 — Shops, businesses and loans

```
Read docs/PROGRESS.md, then implement Phase 6 (§8.5, §8.6, §10, money sinks from §6).
Include the cashier mini-game, the player-item boutique, business milestones and managers,
Bank Kota with credit score and repossession, and Ah Long with debt collector NPCs.
Run the simulator again and rebalance. Update PROGRESS.md and commit.
```

## Phase 7 — Casino and social economy

```
Read docs/PROGRESS.md, then implement Phase 7 (§7.6, §14). Shared multiplayer tables for
roulette, blackjack, crash and the wheel; PvP coinflip; atomic trading; the marketplace with
fees and auctions; leaderboards; gifting; server events. Test with 3 browser tabs.
Update PROGRESS.md and commit.
```

## Phase 8 — End game and polish

```
Read docs/PROGRESS.md, then implement Phase 8 (§13, §17, §19 and the rest of §20 Phase 8).
Finish all content counts in §19, the higher crates, end-game properties, rebirth, sound and
juice passes, mobile performance (particles toggle), and the admin panel. Run a full
simulator balance pass, then do a bug sweep. Update PROGRESS.md and commit.
```

---

## Useful follow-up prompts

- "Run the game and check the browser console and server logs for errors, then fix them."
- "The character looks too plain. Improve the vector art of hair and faces, keep it cartoon chibi."
- "Make the Mythic reveal more dramatic."
- "Players are getting rich too fast. Run the sim and rebalance config so Stage 4 takes ~8 hours."
- "Add a new recipe: Char Kuey Teow with a wok-toss heat meter."
- "Add 10 more furniture items for a new 'Peranakan' theme set."
- "Phones on the WiFi can't connect. Help me debug (firewall, IP, AP isolation)."
