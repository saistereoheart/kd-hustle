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
  - 👹 **Boss room**: guards the stairs down. Beat the boss once to open the stairs for good.
- **Pillars and rubble** inside rooms come from the room's own seed (always the same), for looks and cover.

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
- The server resolves everything; the client plays it back (enemy art at the top, the party at the bottom,
  a text box).

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
5. **Bosses and polish:** floor bosses gating the stairs, balance sim, phone layout pass.
