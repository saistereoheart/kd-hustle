// 🗝️ Labirin Purba: balance (shared/config/labyrinth.json). See docs/LABYRINTH.md.
import { z } from 'zod';

/** What a 💥 skill or 📜 ultimate does (all optional; see battle.ts). */
const labEffect = {
  /** Damage × (like a hit), and the share of the target's DEF it ignores. */
  power: z.number().min(0).optional(), pierce: z.number().min(0).max(1).optional(),
  /** Heals every standing friend this share of their max HP. */
  heal: z.number().min(0).max(1).optional(),
  /** 🔥 Sets it burning: this share of the hit again at the end of each of the next `burnRounds` rounds. */
  burn: z.number().min(0).max(2).optional(), burnRounds: z.number().int().min(1).max(5).optional(),
  /** 💧 Heals you this share of the damage dealt. */
  drain: z.number().min(0).max(1).optional(),
  /** ⚡ Extra critical-hit chance. */
  crit: z.number().min(0).max(0.5).optional(),
};

/** A 💥 skill (an element's free one, or one of its extra variants). */
const labSkillFields = {
  name: z.string(), desc: z.string(),
  /** 🔷 Mana it costs. */
  mana: z.number().int().min(0),
  ...labEffect,
  /** Hits every monster (instead of one). */
  all: z.boolean().optional(),
  /** Acts before everyone else this round / after everyone else. */
  first: z.boolean().optional(), last: z.boolean().optional(),
  /** Hits a random monster (you can't aim it). */
  random: z.boolean().optional(),
  /** You take this share less damage for the whole round (it starts at once, like 🛡️ Guard). */
  shield: z.number().min(0).max(0.9).optional(),
  /** 👊 Hits this many times (each at `power`; DEF counts on every hit, so armour blunts it). */
  hits: z.number().int().min(1).max(4).optional(),
};

export const labConfigSchema = z.object({
  name: z.string(),
  /** Floors, top to bottom. Each one's layout comes from its own seed: never change a seed (it
   *  would remake that floor for everyone). */
  floors: z.array(z.object({
    name: z.string(),
    seed: z.number().int(),
    /** The rooms grid (cells; some stay empty). */
    w: z.number().int().min(4).max(32),
    h: z.number().int().min(4).max(32),
    /** Wall / floor colours of this floor's rooms. */
    wall: z.string(),
    floor: z.string(),
  })).min(1),
  gen: z.object({
    /** Share of grid cells left out (makes the outline ragged). */
    holes: z.number().min(0).max(0.6),
    /** Extra doors between neighbouring rooms beyond the maze (loops, more than one way round). */
    loops: z.number().min(0).max(0.6),
    /** Rooms with a small chest (a loot box). */
    chests: z.number().min(0).max(1),
    /** Rooms with a monster group. */
    monsters: z.number().min(0).max(1),
    /** Locked treasure rooms per floor (each one's key is somewhere else on the floor). */
    treasure: z.number().int().min(0).max(6),
  }),
  /** A room's inside, in tiles (odd numbers keep the doors centred). */
  room: z.object({ w: z.number().int().min(9).max(31), h: z.number().int().min(7).max(25) }),
  /** 🪙 found in a loot box: base × (1 + perFloor × (floor − 1)), ± spread. Treasure: × treasureMult. */
  coins: z.object({ chest: z.number().int().positive(), perFloor: z.number().min(0), spread: z.number().min(0).max(1), treasureMult: z.number().positive() }),
  /** Share of carried coins lost when the whole party falls. */
  deathLoss: z.number().min(0).max(1),
  /** Walking speed inside (px/s at the room's own scale) and the tile size. */
  tile: z.number().int().positive(),
  walkSpeed: z.number().positive(),
  /** ⚔️ Your "weakened state" down here (gear adds to it later). */
  player: z.object({
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().min(0), spd: z.number().positive(),
    /** Focus: +1 a round (max `focusMax`); a 💥 Skill spends `skillCost` for `skillPower` × damage. */
    focusMax: z.number().int().positive(), skillCost: z.number().int().positive(), skillPower: z.number().positive(),
    /** 🛡️ Guard: damage taken × this for the round. */
    guardCut: z.number().min(0).max(1),
    crit: z.number().min(0).max(1), critMult: z.number().min(1),
    /** Out of a fight you get this share of max HP back every 10 s. */
    regenPer10s: z.number().min(0).max(1),
    /** 🔥 Sitting by the entrance hall's campfire: +`hp` HP every `everySec` seconds (on top of the slow regen), within `reach` tiles. */
    campfire: z.object({ hp: z.number().min(0), everySec: z.number().positive(), reach: z.number().positive() }).default({ hp: 1, everySec: 3, reach: 2.2 }),
    /** 🔷 Mana for 💥 skills: `max` (skills can raise it), +`perRound` each fight round, this share of max
     *  back every 10 s out of a fight, and +`campfire` every campfire tick by the hall's fire. It carries
     *  over between fights like HP (rest or fall: full again). */
    mana: z.object({ max: z.number().positive(), perRound: z.number().min(0), regenPer10s: z.number().min(0).max(1), campfire: z.number().min(0) }).default({ max: 20, perRound: 1, regenPer10s: 0.05, campfire: 1 }),
  }),
  battle: z.object({
    /** Seconds to pick (then you ⚔️ Attack). */
    roundSec: z.number().positive(),
    /** 🏃 Run: chance it works. */
    runChance: z.number().min(0).max(1),
    /** A beaten group is back after this many minutes. */
    respawnMin: z.number().positive(),
    /** Damage varies ± this. */
    variance: z.number().min(0).max(0.5),
    /** Monsters per group: 1 + up to this many more (deeper floors fill it). */
    extraMax: z.number().int().min(0).max(4),
  }),
  /** 🐾 Your lead Teman doesn't fight here; it gives a tiny boost (ATK, DEF, HP) by rarity × tier × variant. */
  teman: z.object({
    rarity: z.record(z.string(), z.number().min(0)),
    /** Tier and variant count as their pet multipliers ^ this (soft). */
    soften: z.number().min(0).max(1),
    max: z.number().min(0).max(0.5),
  }),
  /** 🛒 The merchant in the entrance hall and every rest chamber. */
  merchant: z.object({ name: z.string(), line: z.string() }).default({ name: 'Tok Peraih', line: '' }),
  /** 🌿 Bushes and cobwebs: walking into one (each time) may wake something up. A short calm after
   *  every fight (`graceSec`) so you're not jumped again at once. */
  brush: z.object({ chance: z.number().min(0).max(1), graceSec: z.number().min(0) }).default({ chance: 0.12, graceSec: 8 }),
  /** 📦 Breakable crates (each comes back `respawnMin` later, per player) and the 🪨 secret stash in a
   *  cracked rock (one per floor, once): chances and how much (× a loot box's Syiling). */
  crates: z.object({
    respawnMin: z.number().positive(), coinChance: z.number().min(0).max(1), coinMult: z.number().min(0),
    potionChance: z.number().min(0).max(1), potions: z.array(z.string()),
    secretMult: z.number().min(0),
  }).default({ respawnMin: 30, coinChance: 0.45, coinMult: 0.35, potionChance: 0.15, potions: ['jamu_kecil'], secretMult: 5 }),
  /** 🪧 What previous adventurers scrawled on signs down here (tips and warnings). */
  signs: z.array(z.string()).default([]),
  /** 🍵 The tavern in the entrance hall: a drink buffs you for your next few fights (one at a time). */
  tavern: z.object({
    name: z.string(),
    keeper: z.string(),
    line: z.string(),
    drinks: z.array(z.object({
      id: z.string(), name: z.string(), icon: z.string(), price: z.number().int().positive(), desc: z.string(),
      /** Fights it lasts. */
      battles: z.number().int().positive(),
      /** +share of each stat while it lasts. */
      atk: z.number().min(0).max(1).optional(),
      def: z.number().min(0).max(1).optional(),
      hp: z.number().min(0).max(1).optional(),
      spd: z.number().min(0).max(1).optional(),
    })).min(1),
  }).default({ name: 'Kedai Kopi Purba', keeper: 'Mak Jah', line: '', drinks: [{ id: 'teh_tarik', name: 'Teh Tarik', icon: '🍵', price: 20, desc: '+15% ATK', battles: 3, atk: 0.15 }] }),
  /** ⚔️ Gear (kept forever, bought with Syiling): each slot comes in every tier. A tier is sold once
   *  you've reached `minFloor` (0-based). Stats per tier are added to the weakened state. */
  gear: z.object({
    tiers: z.array(z.object({
      id: z.string(), name: z.string(), color: z.string(), minFloor: z.number().int().min(0), price: z.number().int().positive(),
      /** 🐲 Never sold: only dropped (the world boss's mythic set). */
      dropOnly: z.boolean().optional(),
    })).min(1),
    slots: z.array(z.object({
      id: z.enum(['weapon', 'shield', 'armour', 'charm']),
      name: z.string(),
      icon: z.string(),
      atk: z.array(z.number().min(0)).optional(),
      def: z.array(z.number().min(0)).optional(),
      hp: z.array(z.number().min(0)).optional(),
      spd: z.array(z.number().min(0)).optional(),
      /** Extra critical-hit chance. */
      crit: z.array(z.number().min(0).max(0.5)).optional(),
      /** Chance to block a hit (half damage). */
      block: z.array(z.number().min(0).max(0.5)).optional(),
    })),
  }),
  /** 🧪 Potions: carried (up to `max` of each), bought at the merchant. */
  potions: z.object({
    max: z.number().int().min(1),
    list: z.array(z.object({
      id: z.string(), name: z.string(), icon: z.string(), price: z.number().int().positive(), desc: z.string(),
      /** Heals this share of max HP. */
      heal: z.number().min(0).max(1).optional(),
      /** Brings a fallen friend back with this share of max HP (in a fight). */
      revive: z.number().min(0).max(1).optional(),
      /** A sure getaway (in a fight, not from a boss). */
      escape: z.boolean().optional(),
      /** +this share of ATK for the rest of the fight. */
      atkBuff: z.number().min(0).max(2).optional(),
      /** Out of a fight: back to town from anywhere. */
      home: z.boolean().optional(),
      /** 🔷 Gives back this share of max mana. */
      mana: z.number().min(0).max(1).optional(),
    })),
  }),
  /** 📈 Labirin XP (from fights) → levels → skill points (Mata Ilmu) for the skills below. Only counts down here. */
  progress: z.object({
    /** XP per monster (× (1 + perFloor × floor)); a boss gives `boss` × (1 + floor). */
    xp: z.object({ perMonster: z.number().min(0), perFloor: z.number().min(0), boss: z.number().min(0) }),
    /** XP to go from level L to L+1 = base × growth^(L-1). */
    levels: z.object({ base: z.number().positive(), growth: z.number().min(1), max: z.number().int().min(1) }),
    /** Skill points per level (level 1 has `pointsPerLevel` already). */
    pointsPerLevel: z.number().int().min(1),
    /** Syiling to unlearn every skill (at the merchant) and get the points back. */
    respec: z.number().int().min(0),
    /** 🌀 Every level past 1 adds this much to your BASE stats (flat; items add on top; buffs % multiply). */
    perLevel: z.object({ hp: z.number().min(0), atk: z.number().min(0), def: z.number().min(0), mana: z.number().min(0) }).default({ hp: 1.5, atk: 0.08, def: 0.04, mana: 0.3 }),
  }).default({ xp: { perMonster: 6, perFloor: 0.45, boss: 120 }, levels: { base: 30, growth: 1.08, max: 999 }, pointsPerLevel: 1, respec: 200, perLevel: { hp: 1.5, atk: 0.08, def: 0.04, mana: 0.3 } }),
  /** 🌳 The skill tree (permanent; a point a level, no cap on points). Branches; each node has per-rank numbers:
   *  flat ones (hp, atk, def, spd, mana, manaRegen) add to your base stats, `*Pct` ones are buffs (×), crit / block
   *  add chance. `need`: points already spent in its branch to unlock it. `max`: ranks (none = no limit). */
  tree: z.object({
    branches: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string(), color: z.string(), desc: z.string() })).min(1),
    nodes: z.array(z.object({
      id: z.string(), name: z.string(), icon: z.string(), desc: z.string(), branch: z.string(),
      need: z.number().int().min(0), max: z.number().int().min(1).optional(),
      hp: z.number().optional(), atk: z.number().optional(), def: z.number().optional(), spd: z.number().optional(),
      mana: z.number().optional(), manaRegen: z.number().optional(),
      crit: z.number().optional(), block: z.number().optional(),
      atkPct: z.number().optional(), defPct: z.number().optional(), hpPct: z.number().optional(), manaPct: z.number().optional(),
      skillPower: z.number().optional(), spellPower: z.number().optional(), coins: z.number().optional(), regen: z.number().optional(),
      /** Start every fight with this much focus. */
      focus: z.number().optional(),
    })).min(1),
  }).default({ branches: [{ id: 'kuasa', name: 'Kuasa', icon: '⚔️', color: '#ff6b6b', desc: '' }], nodes: [{ id: 'tangan_besi', name: 'Tangan Besi', icon: '👊', desc: '+0.25 ATK', branch: 'kuasa', need: 0, atk: 0.25 }] }),
  /** 📖 Skills (passive, ranked): each rank adds its numbers. `minLevel`: the Labirin level to learn it. */
  skills: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(), desc: z.string(),
    max: z.number().int().min(1), minLevel: z.number().int().min(1),
    /** Per rank: +share of ATK / DEF / max HP, +SPD, +crit chance, +share of 💥 Skill and 📜 spell power,
     *  +share of out-of-fight healing, +share of Syiling from fights. */
    atk: z.number().min(0).optional(), def: z.number().min(0).optional(), hp: z.number().min(0).optional(),
    spd: z.number().min(0).optional(), crit: z.number().min(0).max(0.1).optional(),
    skillPower: z.number().min(0).optional(), spellPower: z.number().min(0).optional(),
    regen: z.number().min(0).optional(), coins: z.number().min(0).optional(),
    /** +share of max 🔷 mana. */
    mana: z.number().min(0).optional(),
  })).default([]),
  /** 📜 Spell books: each gives an ultimate (one book worn at a time) that hits every monster (or heals
   *  the whole party). It costs `focus` focus (a full bar). Sold by the merchant, or won at the tavern's
   *  once-a-day roll (`rollOnly` books only there). */
  spells: z.object({
    focus: z.number().int().min(1),
    roll: z.object({
      price: z.number().int().min(0),
      /** Chance the roll gives a book you don't have yet (else a free drink). */
      bookChance: z.number().min(0).max(1),
    }),
    list: z.array(z.object({
      id: z.string(), name: z.string(), icon: z.string(), color: z.string(), desc: z.string(), move: z.string(),
      /** The element it powers up: with that element's skill equipped, this replaces its basic ultimate. */
      element: z.string().optional(),
      /** On every monster (or, for `heal`, every friend). */
      ...labEffect,
      price: z.number().int().min(0), minFloor: z.number().int().min(0),
      /** Weight in the tavern roll. */
      weight: z.number().min(0),
      rollOnly: z.boolean().optional(),
      /** 🐲 Never sold or rolled: only dropped (the world boss's mythic skill). `element: 'all'` = works with any element. */
      dropOnly: z.boolean().optional(),
    })).min(1),
  }).default({ focus: 3, roll: { price: 40, bookChance: 0.3 }, list: [{ id: 'kitab_api', name: 'Kitab Api Pelita', icon: '🔥', color: '#ff922b', desc: 'Fire on every monster.', move: 'Api Pelita', power: 1.2, price: 450, minFloor: 0, weight: 1 }] }),
  /** 🔥💧⚡🌪️🪨 Elements: each has a free basic 💥 skill (one equipped at a time, change it whenever you like;
   *  it costs mana) and a basic 📜 ultimate in the same style (a spell book of that element replaces it
   *  with a stronger one). Pros and cons differ; none is best at everything. */
  elements: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(), color: z.string(),
    skill: z.object(labSkillFields),
    ultimate: z.object({ move: z.string(), desc: z.string(), ...labEffect }),
    /** 💥 More skills for this element (feedback #29): learn them, then pick one in 🔥 Elements. Sold by the
     *  merchant once you've reached `minFloor` (0-based), or (`boss`: a floor, feedback #30) only once
     *  you've beaten that floor's boss: it teaches you, for Syiling. Yours for good. */
    more: z.array(z.object({
      id: z.string(), ...labSkillFields,
      price: z.number().int().min(0), minFloor: z.number().int().min(0).default(0), boss: z.number().int().min(0).optional(),
    })).default([]),
  })).min(1).default([{ id: 'api', name: 'Api', icon: '🔥', color: '#ff922b', skill: { name: 'Percikan Api', desc: 'A burst of fire.', mana: 8, power: 1.5 }, ultimate: { move: 'Bara Api', desc: 'Embers on every monster.', power: 0.75 }, more: [] }]),
  /** 🐲 The world boss (feedback #21): a party of at least `minParty` together in the entrance hall can call
   *  it, `perWeek` times a week each (the week starts on Monday). HP grows with every player past `minParty`.
   *  Winning pays Syiling + XP to everyone, and each player rolls the rare mythic drops. */
  worldBoss: z.object({
    name: z.string(), icon: z.string(), move: z.string(), line: z.string(),
    hp: z.number().positive(), hpPerPlayer: z.number().min(0), atk: z.number().positive(), def: z.number().min(0), spd: z.number().positive(),
    minParty: z.number().int().min(1), perWeek: z.number().int().min(1),
    coins: z.number().int().min(0), xp: z.number().int().min(0),
    /** Per player per win: a 🐲 set piece (a random slot of the drop-only tier), the boss skill (a book). */
    setChance: z.number().min(0).max(1), skillChance: z.number().min(0).max(1),
    set: z.string(), skill: z.string(),
    /** Its look (like monsters). */
    model: z.string(), color: z.string(),
  }).optional(),
  /** 🎁 Loot (feedback #24): 💎 diamonds (an uncommon drop; they pay for class rolls), and gear drops with a
   *  grade (D..S) and a variant (Shiny / Golden / Rainbow) that multiply a shop piece's stats; scrap them for 💎. */
  loot: z.object({
    diamond: z.object({ perMonster: z.number().min(0).max(1), perFloor: z.number().min(0), boss: z.number().int().min(0), worldBoss: z.number().int().min(0) }),
    item: z.object({ perMonster: z.number().min(0).max(1), boss: z.number().min(0).max(1), max: z.number().min(0).max(1), lowerTier: z.number().min(0).max(1) }),
    grades: z.array(z.object({ id: z.string(), weight: z.number().min(0), mult: z.number().positive(), scrap: z.number().min(0) })).min(1),
    variants: z.array(z.object({ id: z.string(), name: z.string(), oneIn: z.number().min(1), mult: z.number().positive(), scrap: z.number().min(0) })).min(1),
    /** 🎲 Roll for a class: costs 💎; `chance` of a roll-class you don't have yet, else `refund` 💎 back. */
    classRoll: z.object({ price: z.number().int().min(0), chance: z.number().min(0).max(1), refund: z.number().int().min(0) }),
    /** Limited classes: chance per player per floor-boss win / world-boss win. */
    classDrop: z.object({ boss: z.number().min(0).max(1), worldBoss: z.number().min(0).max(1) }),
  }).default({
    diamond: { perMonster: 0.04, perFloor: 0.15, boss: 1, worldBoss: 8 }, item: { perMonster: 0.03, boss: 0.5, max: 0.6, lowerTier: 0.4 },
    grades: [{ id: 'D', weight: 1, mult: 1, scrap: 1 }], variants: [{ id: 'normal', name: 'Normal', oneIn: 1, mult: 1, scrap: 1 }],
    classRoll: { price: 12, chance: 0.35, refund: 4 }, classDrop: { boss: 0.02, worldBoss: 0.04 },
  }),
  /** 🎭 Classes (one worn; switch any time out of a fight): `basic` (everyone has them), `shop` (Syiling at the
   *  merchant), `roll` (the 💎 class roll), `drop` (limited: a floor boss / the world boss). Shares like skills. */
  classes: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(), desc: z.string(),
    source: z.enum(['basic', 'shop', 'roll', 'drop']),
    price: z.number().int().min(0).optional(), weight: z.number().min(0).optional(),
    /** For `drop`: who drops it. */
    from: z.enum(['boss', 'worldBoss']).optional(),
    atk: z.number().optional(), def: z.number().optional(), hp: z.number().optional(), spd: z.number().optional(), crit: z.number().optional(),
    mana: z.number().optional(), skillPower: z.number().optional(), spellPower: z.number().optional(), coins: z.number().optional(),
  })).default([]),
  /** 👹 Floor bosses (one per floor, in its stairs room). They grow with the floor like monsters do
   *  (× scale^floor); more players make them tougher (HP × (1 + partyHp × extra players)) and from
   *  floor `minionsFrom` (0-based) they bring a minion (one more per extra player). */
  boss: z.object({ partyHp: z.number().min(0), minionsFrom: z.number().int().min(0) }).default({ partyHp: 0.7, minionsFrom: 2 }),
  bosses: z.array(z.object({
    name: z.string(), icon: z.string(), move: z.string(), line: z.string().default(''),
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().min(0), spd: z.number().positive(),
    /** Syiling for beating it (once: the stairs stay open after). */
    coins: z.number().int().min(0),
  })).min(1),
  /** Monsters' stats grow per floor (× growth^(floor)). */
  scale: z.object({ hp: z.number().min(1), atk: z.number().min(1), def: z.number().min(1), spd: z.number().min(1) }),
  monsters: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(),
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().min(0), spd: z.number().positive(),
    /** Floors it lives on (0-based, inclusive). */
    floors: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    /** Syiling it drops (× the floor's coin growth). */
    coins: z.number().int().min(0),
    move: z.string(),
    line: z.string().default(''),
    /** Its look: a body shape (rat, bat, snail, spider, worm, golem, cricket, flame, lizard, ghost, pocong, imp,
     *  book, candle, skeleton, mummy, dragon, ogre), its colour and a size (×). */
    model: z.string().optional(), color: z.string().optional(), size: z.number().min(0.5).max(2).optional(),
  })).min(2),
});
export type LabConfig = z.infer<typeof labConfigSchema>;
