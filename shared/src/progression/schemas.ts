// Schemas for the Phase 3 progression configs: levels, wealth stages, titles, the Hustle Skills
// tree (upgrades), daily login + quests, and the Hustle Path (the guided early-game goals).
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = z.string().regex(/^[a-z0-9_]+$/);

/**
 * A condition on a player's progress, used by titles, Hustle Path goals and quests.
 * - stat: a counter in the player's stats (rolls, jobs, manifestSecs...) reaches n
 * - level / stage: player level or wealth stage reaches n
 * - netWorth: net worth reaches `sen`
 * - index: the Item Index is `pct`% complete; indexCount: n different items found
 * - page: the Item Index page of a crate is complete
 * - skill: a Hustle Skill reaches level n
 * - always: everyone has it (the starter title)
 */
export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stat'), stat: z.string(), n: z.number().positive() }),
  z.object({ type: z.literal('level'), n: z.number().int().positive() }),
  z.object({ type: z.literal('stage'), n: z.number().int().positive() }),
  z.object({ type: z.literal('netWorth'), sen: z.number().int().positive() }),
  z.object({ type: z.literal('index'), pct: z.number().positive().max(100) }),
  z.object({ type: z.literal('indexCount'), n: z.number().int().positive() }),
  z.object({ type: z.literal('page'), crate: z.string() }),
  z.object({ type: z.literal('skill'), id: z.string(), n: z.number().int().positive() }),
  z.object({ type: z.literal('always') }),
]);
export type Condition = z.infer<typeof conditionSchema>;

/** A reward: RM, XP, shards, items (potions), and/or one free crate roll. */
export const rewardSchema = z.object({
  sen: z.number().int().nonnegative().optional(),
  xp: z.number().int().nonnegative().optional(),
  shards: z.number().int().nonnegative().optional(),
  items: z.array(z.string()).optional(),
  /** One free roll of this crate (it goes through the normal roll, pity and Index). */
  crate: z.string().optional(),
});
export type Reward = z.infer<typeof rewardSchema>;

// ------------------------------------------------------------------ levels.json
export const levelsConfigSchema = z.object({
  maxLevel: z.number().int().min(2),
  /** XP to go from level L to L+1 = xpBase × L^xpExponent (spec §12). */
  xpBase: z.number().positive(),
  xpExponent: z.number().positive(),
  /** Where XP comes from. */
  xp: z.object({
    /** Per roll, by crate id. */
    crateRoll: z.record(z.string(), z.number().nonnegative()),
    /** A finished (paid) job: jobBase + jobPerRm × RM earned. */
    jobBase: z.number().nonnegative(),
    jobPerRm: z.number().nonnegative(),
    manifestPerMinute: z.number().nonnegative(),
    skillLevel: z.number().nonnegative(),
    pawnSellPerItem: z.number().nonnegative(),
    potionUse: z.number().nonnegative(),
  }),
  /** Reaching level L pays L × this (sen). */
  levelUpSenPerLevel: z.number().int().nonnegative(),
  /** Extra level-up rewards every N levels (e.g. a Luck Potion every 5). */
  milestones: z.array(z.object({ every: z.number().int().positive(), reward: rewardSchema })),
});
export type LevelsConfig = z.infer<typeof levelsConfigSchema>;

// ------------------------------------------------------------------ stages.json
export const stagesConfigSchema = z.object({
  stages: z
    .array(
      z.object({
        n: z.number().int().positive(),
        name: z.string(),
        icon: z.string(),
        color: hex,
        /** Net worth (sen) needed to reach this stage. */
        minNetWorthSen: z.number().int().nonnegative(),
        /** What it unlocks (shown on the HUD and in the Profile app). */
        unlocks: z.array(z.string()),
        /** Reaching it pays this. */
        reward: rewardSchema.optional(),
      }),
    )
    .min(2),
  /** Announce stage-ups from this stage on in chat; big banner for everyone from `bannerFrom`. */
  announceFrom: z.number().int().positive(),
  bannerFrom: z.number().int().positive(),
});
export type StagesConfig = z.infer<typeof stagesConfigSchema>;
export type StageDef = StagesConfig['stages'][number];

// ------------------------------------------------------------------ titles.json
export const titlesConfigSchema = z.object({
  titles: z.array(
    z.object({
      id,
      name: z.string(),
      /** A rarity tier id (colours the title). */
      rarity: z.string(),
      desc: z.string(),
      cond: conditionSchema,
      /** Small bonuses while the title is worn. */
      bonus: z.object({ luck: z.number().min(1).optional(), xp: z.number().min(1).optional(), jobPay: z.number().min(1).optional() }).optional(),
      /** Hidden until earned (shown as ???). */
      secret: z.boolean().default(false),
    }),
  ),
  /** Rarity tiers from this one up are announced in chat when earned. */
  announceFrom: z.string(),
});
export type TitlesConfig = z.infer<typeof titlesConfigSchema>;
export type TitleDef = TitlesConfig['titles'][number];

// ------------------------------------------------------------------ upgrades.json
export const SKILL_EFFECTS = [
  'luck', 'variantChance', 'pity', 'potionDuration', 'unlock', 'rollSpeed',
  'manifestRate', 'passiveIncome', 'jobPay', 'carwashSeconds', 'xp', 'walkSpeed',
] as const;
export type SkillEffect = (typeof SKILL_EFFECTS)[number];

export const upgradesConfigSchema = z.object({
  /** Manifest earnings are banked and paid out (one DB write) every N seconds. */
  manifestFlushEverySec: z.number().int().positive(),
  branches: z.array(
    z.object({
      id,
      name: z.string(),
      icon: z.string(),
      /** Branch has no skills yet: shown greyed with this note. */
      comingSoon: z.string().optional(),
    }),
  ),
  skills: z.record(
    id,
    z.object({
      branch: z.string(),
      name: z.string(),
      icon: z.string(),
      desc: z.string(),
      maxLevel: z.number().int().positive(),
      /** Level you have without buying anything (Manifesting starts at 1, the rest at 0). */
      startLevel: z.number().int().nonnegative().default(0),
      /** Cost to go from level L to L+1 = baseCostSen × costGrowth^(L − startLevel). */
      baseCostSen: z.number().int().positive(),
      costGrowth: z.number().min(1),
      /** What one level does. Value = base + perLevel × (level − startLevel). */
      effect: z.object({ kind: z.enum(SKILL_EFFECTS), perLevel: z.number(), base: z.number().default(0) }),
      /** Player level / wealth stage needed to buy the first level. */
      requires: z.object({ level: z.number().int().positive().optional(), stage: z.number().int().positive().optional() }).default({}),
    }),
  ),
});
export type UpgradesConfig = z.infer<typeof upgradesConfigSchema>;
export type SkillDef = UpgradesConfig['skills'][string];

// ------------------------------------------------------------------ quests.json
export const questsConfigSchema = z.object({
  perDay: z.number().int().positive(),
  /** Day 1–7 login streak rewards (spec §15). Day 8 starts again at day 1. */
  login: z.array(rewardSchema).length(7),
  daily: z.array(
    z.object({
      id,
      /** {n} is replaced by the target (formatted as RM or minutes per `format`). */
      text: z.string(),
      icon: z.string(),
      stat: z.string(),
      format: z.enum(['count', 'money', 'minutes']).default('count'),
      /** Target per wealth stage (index 0 = stage 1; the last entry is used for higher stages). */
      targets: z.array(z.number().positive()).min(1),
      minStage: z.number().int().positive().default(1),
      reward: z.object({
        /** RM per wealth stage (same indexing as targets). */
        senByStage: z.array(z.number().int().nonnegative()).min(1),
        xp: z.number().int().nonnegative(),
        items: z.array(z.string()).optional(),
      }),
    }),
  ),
});
export type QuestsConfig = z.infer<typeof questsConfigSchema>;
export type QuestDef = QuestsConfig['daily'][number];

// ------------------------------------------------------------------ goals.json
/** The Hustle Path: ordered goals that walk a new player through the first couple of hours. */
export const goalsConfigSchema = z.object({
  goals: z.array(
    z.object({
      id,
      text: z.string(),
      /** Where / how (shown under the goal). */
      hint: z.string().optional(),
      cond: conditionSchema,
      reward: rewardSchema,
    }),
  ),
});
export type GoalsConfig = z.infer<typeof goalsConfigSchema>;
export type GoalDef = GoalsConfig['goals'][number];
