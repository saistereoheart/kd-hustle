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
- **Gear** (kept forever, bought with 🪙):
  - 🗡️ weapon: ATK;
  - 🛡️ shield: DEF, plus a block chance;
  - 🥋 armour: HP and DEF;
  - 📿 charm: SPD and crit.

  Each comes in tiers: Kayu → Besi → Gangsa → Perak → Emas → Mistik.
- **Potions** (consumables, carried up to a limit):
  - 🧪 Jamu Kecil / Sederhana / Besar: heal;
  - 💫 Air Penawar: revives a fallen ally in battle;
  - 💨 Asap Lari: guaranteed escape (not from bosses);
  - 🌶️ Sambal Semangat: +ATK for the battle;
  - 🧵 Tali Pulang: leave the labyrinth from anywhere.
- **Teman don't fight here.** Your lead Teman gives a *tiny* buff, by rarity × tier × variant. Common ≈ +1%,
  a maxed mythic ≈ +8% at most, applied to one stat by species.

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
- From the 📱 Labirin app or the entrance hall: create a party, invite online players (they get an Accept
  prompt), up to 4 players.
- Party members see each other on the map. In the same room they see each other walk and fight together.
  Non-party players in the same room can see you but fight their own battles.

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
3. **Gear:** merchant, gear and potions, equipping, treasure rooms and keys.
4. **Party:** lobby, invites, shared rooms and battles.
5. **Bosses and polish:** floor bosses gating the stairs, balance sim, phone layout pass.
