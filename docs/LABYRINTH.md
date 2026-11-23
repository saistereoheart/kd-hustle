# 🗝️ Labirin Purba: the walkable dungeon (design)

A second dungeon, next to Gua Gelap. In Gua Gelap your Teman fight from a menu. In Labirin Purba **you walk
it yourself**, room by room, in a "weakened state". The game's own power (gear, luck, levels) doesn't come
in with you. You fight with what you find and buy down there.

Source of truth for this feature (the game spec points here: GAME_SPEC §22). Balance lives in
`shared/config/labyrinth.json`.

## 1. Shape of the world
- **Floors** (8 to start). Each floor is a grid of rooms (13 × 13 cells, some cells empty), so roughly
  110–150 rooms per floor and about 1,000 in all.
- **Permanent layout.** Each floor is generated from a fixed seed in the config, so it's the same for
  everyone, every day. Changing the seed would remake the floor, so don't. Shared code builds it the same
  way on the server and the client (`shared/src/lab/generate.ts`, unit-tested).
- **A maze with loops.** It's a perfect maze plus ~12% extra openings, so there are several routes but
  plenty of dead ends.
- **Room view.** You only see the room you're in. Its doors sit on the walls (N / E / S / W). Going
  through the east door brings you in through the west door of the next room.
- **Room types:**
  - 🚪 **Start**: the stairs down from the floor above (floor 1: the entrance hall, with the shop).
  - ▫️ **Chamber**: most rooms. About 45% hold a monster group (the encounter).
  - 💰 **Treasure room**: a locked dead end. Its 🗝️ key is somewhere else on the floor.
  - 📦 **Loot box**: a small chest in about 8% of rooms. It refills daily, per player.
  - 🔥 **Rest chamber**, one per floor: the **save point**. It heals you, banks your coins, sets where you
    come back, and has a merchant. Deliberately hard to find: it's at the dead end furthest from both the
    start and the stairs.
  - 👹 **Boss room**: guards the stairs down. Beat the boss once to open the stairs for good (see §4b).
- **Rooms are caves, not boxes** (`roomLayout`, from the room's own seed, so always the same):
  - jagged rock juts in from the walls;
  - ordinary chambers get outcrops, bent rock walls that close off little nooks, and boulders;
  - the cross of main paths between the doors (3 tiles wide), every spot and the way to it always stay clear;
  - floor you can't reach becomes rock.
- **Roofs:** a rock tunnel over each doorway, and sometimes an overhang across a path. They hide what's under
  them and turn see-through when you walk under.
- **Look** (drawn in code, `client/src/world/labRoomArt.ts`): a moody night palette.
  - Irregular flagstones, and a winding cobbled path with edge stones between the doors.
  - Raised rock that hides whoever stands behind it, with frost and cracks.
  - Torches with warm glow, and a dark vignette.
  - It's drawn once per room into a few pictures, so a frame costs the same as a plain room.
- **🌿 Bushes and cobwebs** (ordinary chambers, a few clumps; part of the room's fixed layout).
  - You can walk through them.
  - Every time you step into one, there's a `brush.chance` (12%) chance that a monster group jumps out:
    an ambush.
  - After any fight there's a short calm (`brush.graceSec`, 8 s).
  - Beating an ambush doesn't clear the room's own group.
  - The server rolls it on the step (`LabSystem.brushStep`).
- **Things lying about:**
  - Wall lamps, with a pool of light on the floor, a halo and a flickering flame.
  - Signs with tips or warnings from earlier adventurers (`signs` in the config; press E to read).
  - Skeletons and cold campfires (with a little story when you look).
  - Rest chambers have a working campfire with one or two adventurers resting by it.
- **🌀 In and out by portal.**
  - You enter from the 📱 Labirin app and appear in front of the purple portal: the entrance hall's,
    top left, or your rest chamber's.
  - To leave, walk up to a portal and press E. There's no Leave button.
  - The server checks you're at the portal (`spot.portal`). 🧵 Tali Pulang still takes you home from
    anywhere.
- **Look:** a pixel-art style, with the room pictures drawn at low sharpness and shown with hard edges.
  - Dark, warm stone, cobbles, puddles that catch the light, banners, barrels and crates, a stone arch
    over the north door.
- **The entrance hall** (laid out like the reference picture):
  - the portal (top left);
  - the merchant, an old sage with a staff and a glowing orb, on a red rug by his stall;
  - the tavern, a timber building with lit windows, bottle shelves, a roof, a cup sign, the counter,
    stools and barrels;
  - tables with mugs, a long table and bench with people, the campfire circle, and lamps.
- **The entrance hall (before v1.21):**
  - 🛒 Tok Peraih's stall: a table with potions. He holds a staff topped with a glowing orb.
  - 🍵 the tavern (Mak Jah behind her counter, shelves of bottles).
  - A campfire with three adventurers sitting round it, and benches with two more. They chat now and then.
  - The counter, fire and benches are solid.
- **🍵 Tavern drinks** (`tavern` in the config):
  - A buff for your next few fights: +ATK, DEF, max HP and/or SPD.
  - One drink at a time; a new one replaces the old.
  - Paid in Syiling, carried coins first. Server-checked (`lab:drink`, at the counter).
  - The HUD shows the drink's icon and how many fights it has left.
- **Signs say what each thing does**, e.g. "🚪 EXIT: back to town / banks your carried Syiling",
  "🛒 SHOP / gear & potions", "🔥 Campfire: rest & save", "🗝️ Key / opens this floor's 🔒 treasure door".
  Doors say where they lead: ↩ Back, ❔ Unexplored, 🔒 Locked door, or the kind of room once you've seen it.

## 2. Weakened state and gear
- Inside, your stats are the labyrinth's own: **HP 100 · ATK 10 · DEF 4 · SPD 10**, plus your labyrinth gear.
  Town gear, luck, potions and skills don't count.
- **Gear** (kept forever, bought from 🛒 **Tok Peraih**, the merchant in the entrance hall and every rest
  chamber):
  - 🗡️ Keris (weapon): ATK;
  - 🛡️ Perisai (shield): DEF, plus a chance to block half of a hit;
  - 🥋 Baju Zirah (armour): HP and DEF;
  - 📿 Tangkal (charm): SPD and crit.

  Each comes in six tiers. A tier is sold once you've reached its floor:

  | Tier | Sold from | Price (each) | A full set |
  |---|---|---|---|
  | Kayu | the start | 30 | ×1.3 |
  | Besi | the start | 150 | ×1.7 |
  | Gangsa | floor 2 | 500 | ×2.3 |
  | Perak | floor 3 | 1,400 | ×3.0 |
  | Emas | floor 5 | 3,500 | ×3.8 |
  | Mistik | floor 6 | 8,000 | ×4.7 |

  Buying a piece wears it at once if it beats what's in that slot. You can wear any piece you own from
  🎒 Bag (also from the 📱 app in town).
- **Potions** (carried, up to 9 of each):
  - 🧪 Jamu Kecil / Sederhana / Besar (8 / 20 / 45): heal 30% / 60% / all of your HP;
  - 💫 Air Penawar (40): revives a fallen ally in battle with 40% HP;
  - 💨 Asap Lari (15): a sure getaway (not from bosses);
  - 🌶️ Sambal Semangat (25): +30% ATK for the rest of the battle;
  - 🧵 Tali Pulang (60): out of a fight, back to town from anywhere (banks your carried coins).

  In a fight a potion takes your turn, and it acts before anyone attacks. Out of a fight, drink heals and
  use Tali Pulang from 🎒 Bag.
- **Teman don't fight here.** Your lead Teman gives a *tiny* buff, by rarity × tier × variant. Common ≈ +1%,
  a maxed mythic ≈ +8% at most, applied to one stat by species.
- **Balance** (solo, one fight from full HP): a full set of the tier sold on a floor wins almost every
  fight there, and about two in three on the next floor down. The bottom two floors stay hard alone: they
  want a party. The win-rate tests in `shared/src/lab/battle.test.ts` guard this.

## 3. Currency: 🪙 Syiling Purba
- Only earned in the labyrinth: battles, loot boxes, treasure rooms, bosses. Only spent at its merchants.
  It's a grind on purpose.
- **Carried vs banked.** Coins you pick up are *carried*. They're banked when you rest at a rest chamber or
  leave. If your whole party falls, you lose half your carried coins and wake at your last rest chamber.

## 4. Battles (Pokémon style)
- Entering a room with a living monster group starts a battle with everyone in your **party who is in that
  room**. Party members who walk in during the battle join from the next round.
- Each round every player picks:
  - ⚔️ Attack (a target);
  - 💥 Skill (from the weapon; costs focus);
  - 🛡️ Guard;
  - 🧪 Item;
  - 🏃 Run (not against bosses).

  The round resolves when everyone has picked, or after 20 s (then Attack). Speed decides the order.
- **Win:** coins and labyrinth XP (it raises the labyrinth's own level a little). The group is gone for you
  for 20 minutes.
- **Party wipe:** see §3. **Run:** you step back to the room you came from.
- The server resolves everything; the client plays it back.
- **3D** (default, Settings → ⚔️ Labirin fights): three.js, `client/src/ui/lab/battle3d/`.
  - A torch-lit cave arena, with chibi models built in code for each monster, each boss (bigger, with a
    crown) and each player (in their own colours).
  - Exaggerated moves: wind-up, lunge, a short freeze on impact (hit-stop), knockback, screen shake, slash
    arcs, sparks, shockwave rings, a charge aura and zoom punch on skills, giant damage numbers.
  - Tap a monster to aim at it.
- **Kept light** for the 30 FPS rule:
  - three.js is its own download, loaded only when a fight starts; the graphics are freed when it ends.
  - The 2D game pauses while the fight draws.
  - Low-poly shapes, cheap lighting and capped particles.
  - If a device drops below 30 FPS it first lowers the sharpness, then switches to the 2D cards and
    remembers that choice.

## 4b. Floor bosses
- Each floor's stairs room has its boss:
  1. Raja Tikus Lumut 🐀
  2. Ratu Labah Akar 🕷️
  3. Golem Kristal 🗿
  4. Raksasa Bara 👹
  5. Hantu Raya 👻
  6. Penjaga Pustaka 📚
  7. Raja Jerangkung 💀
  8. Naga Purba 🐉

  It stands in front of the stairs and jumps out when you walk in. The stairs down stay shut until you've
  beaten it. After that the room is quiet, and the stairs are open for good for everyone who won the fight.
- No running and no Asap Lari against a boss. A boss has its own stats per floor (`labyrinth.json →
  bosses`); its HP grows by 70% for each extra player, and from floor 3 it brings minions (one per
  player, up to 3).
- It pays its Syiling once (120 on floor 1 up to 1,200 on floor 8).
- **Balance** (no potions, full HP; win rate against the boss):

  | | Solo, with the tier sold on that floor | A full Mistik party |
  |---|---|---|
  | Floors 1–6 | about 50–70% | (easy) |
  | Floor 7 (Raja Jerangkung) | 0% (needs friends) | 2 players 43%, 3: 71%, 4: 100% |
  | Floor 8 (Naga Purba) | 0% | 2 players 16%, 3: 32%, 4: 64% |

  Potions (Jamu, Sambal, Air Penawar) push these up a good deal. Tests in `labBattles.test.ts` cover
  the rules.

## 4c. Labirin XP, skills and spell books (v1.27.0)
All numbers are in `shared/config/labyrinth.json` (`progress`, `skills`, `spells`); the rules are in
`shared/src/lab/progress.ts`.

- **XP:** every player still in a won fight gets the group's XP: `perMonster × (1 + perFloor × floor)`
  per monster, `boss × (1 + floor)` per boss. XP for level L→L+1 = `base × growth^(L-1)` (40, ×1.25),
  up to level 40.
- **Skill points (Mata Ilmu):** `pointsPerLevel` per level (level 1 already has one). Learning a rank
  costs one point, out of a fight, anywhere. Each skill has a max rank and a minimum level. Tok Peraih
  unlearns them all for `respec` Syiling.
- **Skills** (per rank): ATK +5%, DEF +6%, max HP +6%, SPD +1, healing out of a fight +25%, crit +1.5%,
  💥 Skill damage +8%, 📜 spell power +10%, Syiling from fights +5%. They only count down here.
- **Spell books:** each belongs to an element (see §4d) and powers up that element's ultimate while it's
  equipped. The ultimate (📜 Ultimate, the 4th fight button) costs a full focus bar (3) and hits every
  monster at once (or heals every standing friend). Sold by Tok Peraih (450 to 4,200, by floor), or won at
  the tavern's once-a-day roll (40 Syiling, 30% chance of a book you don't have, weighted; Kitab Gempa
  Purba only comes from the roll). No book: a free drink instead.
- **Fight keys:** 1 Attack, 2 Skill, 3 Guard, 4 Ultimate, 5 Items, 6 Run, Q switch element.

## 4d. Elements, mana and damage tiers (v1.34.0 feedback #20; tiers v1.36.0 feedback #26)
Numbers in `labyrinth.json` (`elements`, `player.mana`); rules in `shared/src/lab/battle.ts`.
- **Damage:** each hit is ATK × the move's power, cut by the target's DEF (`a²/(a+DEF)`, a = ATK × power), ±15%,
  then a crit (×1.6). **Tiers:** ⚔️ Attack ×1 → 💥 Skill ×1.2–1.9 (costs mana) → 📜 Ultimate ×1.5–2.3 on
  every monster (a full focus bar: 6 rounds); spell books ×2.4–3. Bosses got about 30% more HP to match.
- **Elements:** 🔥 Api, 💧 Air, ⚡ Petir, 🌪️ Angin, 🪨 Tanah. One is equipped (default Api); switch any time,
  mid-fight too (free, from your next pick). Its free basic 💥 skill is the Skill button:
  - 🔥 ×1.8 and burns (20% of the hit for 2 rounds), 11 mana; ultimate ×2.3 + burn;
  - 💧 ×1.7 and heals you 30% of the damage, 9 mana; ultimate ×1.9 + party heal 10%;
  - ⚡ ×1.9, +10% crit, always first, but a random target, 10 mana; ultimate ×2.3;
  - 🌪️ ×1.2 on every monster, 10 mana; ultimate ×1.9;
  - 🪨 −35% damage taken that round (starts at once), ×1.9 but last, 9 mana; ultimate ×2.2.
- **Ultimate:** the element's own basic ultimate (all hit every monster, each with its element's effect), or
  the stronger spell book of that element if you own it.
- **Mana:** max 20 (+10% a rank of 🔷 Tenaga Dalam), +1 per fight round, 5% of max per 10 s outside a fight,
  +1 per campfire tick by the hall's fire; full again when you rest or fall. Carried over between fights.
  Potions: 🥥 Air Kelapa +50%, 🍯 Madu Kelulut full. Monsters don't use mana (their skill still uses focus).
- **Balance check:** a scratch sim with the real `resolveLabRound` (F1–F8, gear none → mistik). Every element
  stays within a few points of the old 💥 Skill in normal fights; bosses 48–81% with the intended gear.

## 5. Party / lobby
- From 👥 (the labyrinth's top bar) or the 📱 Labirin app: invite players who are online. They get a
  Join / No thanks prompt, wherever they are, and the invite runs out after a minute. Inviting someone
  makes you the leader (👑); the leader can remove members. Up to 4 players.
- Party members are dots on each other's map (red while fighting), even in rooms you haven't seen.
- When you walk into a monster room, the party members who are in that room fight with you, and the group
  is bigger for more players. Walking into a room where your party is fighting joins that fight.
  Non-party players in the same room can see you but fight their own battles.
- Each player gets the group's Syiling for a win. Someone who falls waits it out: if the party wins they're
  back up at 1 HP; Air Penawar brings them back during the fight.
- Parties live in the server's memory: a restart ends them, and so does leaving the game (after the
  reconnect grace).

## 6. Map
- A **minimap** of explored rooms near you (top right; it replaces the town minimap inside).
- **Tap it for the full floor map**, limited to the labyrinth: fog of war, you, your party, and found
  stairs / rest chamber / treasure / merchant.
- What you've explored is saved per floor, per player.

## 7. Saving and leaving
- Position and progress are server-side and saved with the rest of your save (`playerData` key `lab`).
- **Leave** at the entrance hall or a rest chamber, or anywhere with 🧵 Tali Pulang. Disconnecting
  mid-battle counts as running away. Next time you enter, you start at your last rest chamber, or choose
  the entrance hall.

## 8. Phases
1. ✅ **Explore** (1.10.0): generator and tests, enter/leave, rooms, doors, walking, others in the room, minimap and
   map, rest chambers, stairs, loot boxes (🪙).
2. ✅ **Fight** (1.11.0): weakened stats, monster groups, solo battle engine and UI, death and respawn, Teman buff.
3. ✅ **Gear** (1.13.0): the merchant (Tok Peraih), 24 pieces of gear, 7 potions, equipping, 🧪 Items in battle.
   Treasure rooms and keys came with part 1.
4. ✅ **Party** (1.14.0): invites, a party panel, party members on the map, shared battles and joining a fight.
5. ✅ **Bosses and polish** (1.15.0): floor bosses gating the stairs, the boss balance pass, and a phone
   layout pass (the top bar wraps across the screen, the minimap sits under it, town chips hidden).

All five parts are done. Ideas for later: monster art beyond emoji, labyrinth levels / XP, weekly
leaderboards for the deepest floor, more floors (new seeds only: never change an existing one).
