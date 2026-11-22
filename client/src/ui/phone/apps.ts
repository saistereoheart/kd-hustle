// 📱 The HustlePhone's apps, sorted into a few groups so they're easy to find. Each app has a
// short "what it does" line and a plain description, shown in the 💡 Tips window beside the phone.
import { menuRecipes, questProgress, stockCount } from '@kh/shared';
import type { App } from '../../app';
import { openInventoryPanel } from '../inventoryPanel';
import { openJobsPanel } from '../jobs';
import { openDungeon } from '../dungeon/dungeon';
import { openLabPanel } from '../lab/labPanel';
import { openPetsPanel } from '../pets/petsPanel';
import { openGarage } from '../garage/garage';
import { openFurnitureStore } from '../property/furnitureStore';
import { renderBusiness } from './business';
import { renderVentures } from './ventures';
import { renderBank } from './bank';
import { renderBoutique } from './boutique';
import { renderSpin } from './spin';
import { renderRadio } from './radio';
import { renderPlayers } from './players';
import { renderBoards } from './boards';
import { renderMarket } from './market';
import { renderRebirth } from './rebirth';
import { renderDaily } from './daily';
import { renderPath } from './path';
import { renderProfile } from './profile';
import { renderQuests } from './quests';
import { renderRides } from './rides';
import { renderSkills } from './skills';
import { renderTitles } from './titles';
import { renderAchievements } from './achievements';
import { renderHandbook } from './handbook';
import { renderClock } from './clock';
import { renderProperties } from './properties';
import { renderRolls } from './rolls';

export interface PhoneCtx {
  app: App;
  /** Re-render the current app (after an action). */
  rerender: () => void;
  go: (id: string | null) => void;
}

export interface PhoneCategory {
  id: string;
  name: string;
  icon: string;
}

export interface PhoneApp {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Which group it sits in on the home screen. */
  cat: string;
  /** 💡 Tips: what it's for, in a few words. */
  does: string;
  /** 💡 Tips: a short, plain description. */
  about: string;
  /** Renders inside the phone. */
  render?: (ctx: PhoneCtx) => Array<HTMLElement | null>;
  /** Opens something outside the phone instead. */
  open?: (app: App) => void;
  /** `open` shows a window on top of the phone (‹ Back returns to the phone); otherwise the
   *  phone closes first (the full map, settings). */
  stacks?: boolean;
  /** Red badge on the icon (e.g. "!" when something is claimable). */
  badge?: (app: App) => string | null;
}

export const CATEGORIES: PhoneCategory[] = [
  { id: 'today', name: 'Today', icon: '🎁' },
  { id: 'earn', name: 'Make money', icon: '💰' },
  { id: 'shop', name: 'Shop & bank', icon: '🛍️' },
  { id: 'me', name: 'Me', icon: '🎒' },
  { id: 'play', name: 'Adventure', icon: '⚔️' },
  { id: 'goals', name: 'Goals & ranks', icon: '🏆' },
  { id: 'town', name: 'Town & tools', icon: '🧭' },
];

export const APPS: PhoneApp[] = [
  // 🎁 Today
  {
    id: 'daily', name: 'Daily', icon: '🎁', color: '#e64980', cat: 'today', render: renderDaily,
    does: 'A free gift every day.',
    about: 'Claim once a day. Come back 7 days in a row for bigger gifts: day 7 is a free crate roll. Miss a day and you start again.',
    badge: (app) => (app.store.progress.daily.canClaim ? '!' : null),
  },
  {
    id: 'quests', name: 'Quests', icon: '📜', color: '#f59f00', cat: 'today', render: renderQuests,
    does: 'Small tasks with rewards.',
    about: '3 new quests every day and bigger ones every Monday. When one is done, tap Claim.',
    badge: (app) => {
      const pr = app.store.progress;
      const n = [...pr.quests, ...(pr.weekly ?? [])].filter((q) => {
        const def = app.cfg.quests.daily.find((d) => d.id === q.id) ?? app.cfg.quests.weekly.find((d) => d.id === q.id);
        return def && !q.claimed && questProgress(def, q, pr.stats).done;
      }).length;
      return n ? String(n) : null;
    },
  },
  {
    id: 'spin', name: 'Lucky Spin', icon: '🎡', color: '#f08c00', cat: 'today', render: renderSpin,
    does: 'One free spin a day.',
    about: 'Spin the wheel for cash and prizes. The cash prizes grow as you get richer.',
    badge: (app) => (app.store.canSpin ? '!' : null),
  },
  {
    id: 'path', name: 'Hustle Path', icon: '🎯', color: '#40c057', cat: 'today', render: renderPath,
    does: 'Your next goal, step by step.',
    about: 'New here? Follow these goals in order. Each one pays you the moment you finish it.',
  },

  // 💰 Make money
  {
    id: 'jobs', name: 'Jobs', icon: '📋', color: '#2b8a3e', cat: 'earn', open: (app) => openJobsPanel(app, { remote: true }), stacks: true,
    does: 'Take a job, get paid.',
    about: 'Deliveries, car washes and more. Steady money, best when you are just starting out.',
  },
  {
    id: 'business', name: 'Business', icon: '🏪', color: '#e8590c', cat: 'earn', render: renderBusiness,
    does: 'Run your own food stall.',
    about: 'Buy a stall, keep it stocked, cook and hire staff. Grow it from pasar malam to food truck to kopitiam.',
    // Nothing on the menu in stock = no customers.
    badge: (app) => {
      const st = app.store.stall;
      return st && !menuRecipes(app.cfg.stalls, app.cfg.recipes.recipes, st).some((r) => stockCount(st, r.id) > 0) ? '!' : null;
    },
  },
  {
    id: 'ventures', name: 'Ventures', icon: '🏢', color: '#5c940d', cat: 'earn', render: renderVentures,
    does: 'Businesses that earn for you.',
    about: 'Buy and level up businesses, then collect the money. Hire a manager and they collect it for you. Your kedai runcit is here too.',
    badge: (app) => (Object.values(app.store.ventures.businesses).some((b) => b.level && !b.manager && b.stored) ? '💰' : null),
  },
  {
    id: 'properties', name: 'Properties', icon: '🏠', color: '#0b7285', cat: 'earn', render: renderProperties,
    does: 'Rent out your homes.',
    about: 'Choose rent, Airbnb or live in it. Set a fair price, keep tenants and guests happy, hire a cleaner, or sell.',
    badge: (app) => (app.store.myProps.some((p) => p.requests.length) ? '!' : null),
  },

  // 🛍️ Shop & bank
  {
    id: 'rolls', name: 'Quick Rolls', icon: '🎰', color: '#f03e3e', cat: 'shop', render: renderRolls,
    does: 'Open crates from anywhere.',
    about: 'Roll any crate for random items. A small fee on the phone; free at the crate machine in town.',
  },
  {
    id: 'market', name: 'Pasar Online', icon: '🛒', color: '#2f9e44', cat: 'shop', render: renderMarket,
    does: 'Buy and sell with players.',
    about: 'Sell at a set price or as an auction, and check what items are worth. A small fee on every sale.',
  },
  {
    id: 'boutique', name: 'Butik', icon: '👜', color: '#c2255c', cat: 'shop', render: renderBoutique,
    does: 'Players’ own shops.',
    about: 'Buy what other players put on display, or open your own butik and set your prices. You still get paid when you are offline.',
  },
  {
    id: 'ikeja', name: 'IKEJA Online', icon: '🛋️', color: '#1971c2', cat: 'shop', open: (app) => openFurnitureStore(app, { online: true }), stacks: true,
    does: 'Order furniture to your bag.',
    about: 'Every piece the furniture store sells, ordered from anywhere and delivered straight to your bag, for a delivery fee (10%, at least RM 50). Walk into the store to skip the fee.',
  },
  {
    id: 'garage', name: 'Garage', icon: '🚗', color: '#c92a2a', cat: 'shop', open: (app) => openGarage(app), stacks: true,
    does: 'Your cars and bikes.',
    about: 'Ride them, put them on your hotbar, tune the engine and tyres, repaint, and fit an exhaust. Buy new ones at the showroom.',
  },
  {
    id: 'bank', name: 'Bank', icon: '🏦', color: '#1864ab', cat: 'shop', render: renderBank,
    does: 'Borrow money, pay it back.',
    about: 'Bank Kota lends by your credit score. The Ah Long gives cash right away but charges 20% a day. Be careful!',
    badge: (app) => (app.store.bank?.owesAhLong ? '🦈' : app.store.bank?.loans.some((l) => l.missed) ? '!' : null),
  },

  // 🎒 Me
  {
    id: 'profile', name: 'Profile', icon: '👤', color: '#0ca678', cat: 'me', render: renderProfile,
    does: 'Your level, wealth and luck.',
    about: 'See your XP, how rich you are, where your luck comes from, your active potions and your stats.',
  },
  {
    id: 'bag', name: 'Bag', icon: '🎒', color: '#d9480f', cat: 'me', open: (app) => openInventoryPanel(app, 0), stacks: true,
    does: 'Everything you own.',
    about: 'Wear, use and sort your items. Opens a bigger window.',
  },
  {
    id: 'pets', name: 'Teman', icon: '🐾', color: '#2b8a3e', cat: 'me', open: (app) => openPetsPanel(app), stacks: true,
    does: 'Your pets.',
    about: 'Train your Teman, upgrade their stats and gear, and pick your battle team.',
  },
  {
    id: 'skills', name: 'Skills', icon: '⬆️', color: '#7048e8', cat: 'me', render: renderSkills,
    does: 'Upgrade yourself.',
    about: 'More pay, luck, XP, rent and speed. Each level costs more; some skills need a higher level first.',
  },
  {
    id: 'rides', name: 'Ronda', icon: '🛵', color: '#2f9e44', cat: 'me', render: renderRides,
    does: 'Get a ride or hop on yours.',
    about: 'Pay a fare to get from A to B fast, or jump on a vehicle you own.',
  },

  // ⚔️ Adventure
  {
    id: 'dungeon', name: 'Gua Gelap', icon: '⚔️', color: '#5f3dc4', cat: 'play', open: (app) => openDungeon(app), stacks: true,
    does: 'Pet battles in the cave.',
    about: 'Your Teman team fights the cave monsters, one turn at a time. Use Auto or Skip when you are busy.',
  },
  {
    id: 'lab', name: 'Labirin', icon: '🗝️', color: '#495057', cat: 'play', open: (app) => openLabPanel(app), stacks: true,
    does: 'Explore the old labyrinth.',
    about: 'Go deeper floor by floor, alone or with friends. Find coins and loot, and beat the floor bosses.',
  },

  // 🏆 Goals & ranks
  {
    id: 'titles', name: 'Titles', icon: '🏷️', color: '#1c7ed6', cat: 'goals', render: renderTitles,
    does: 'Show off a title.',
    about: 'Earn titles by reaching milestones. Wear one over your head.',
  },
  {
    id: 'trophies', name: 'Trophies', icon: '🏅', color: '#e67700', cat: 'goals', render: renderAchievements,
    does: 'Your achievements.',
    about: 'One-time goals that each pay a reward. You keep them even after a rebirth.',
  },
  {
    id: 'boards', name: 'Leaderboards', icon: '🏆', color: '#e67700', cat: 'goals', render: renderBoards,
    does: 'Who is on top?',
    about: 'See how you rank against everyone who has played.',
  },
  {
    id: 'rebirth', name: 'Rebirth', icon: '⭐', color: '#5f3dc4', cat: 'goals', render: renderRebirth,
    does: 'Start again, earn more.',
    about: 'Once you reach wealth stage 6, start a new life. You keep your level, and every rebirth doubles the cash you earn.',
    badge: (app) => (app.store.rebirth?.can ? '⭐' : null),
  },

  // 🧭 Town & tools
  {
    id: 'map', name: 'Map', icon: '🗺️', color: '#1098ad', cat: 'town', open: (app) => app.minimap?.openFull(),
    does: 'See the whole town.',
    about: 'Find where everything is. The phone closes to show the map (M also opens it).',
  },
  {
    id: 'players', name: 'Players', icon: '👥', color: '#3b5bdb', cat: 'town', render: renderPlayers,
    does: 'Who is online. Trade and gift.',
    about: 'See who is playing, trade items safely, or gift money and items to a friend.',
  },
  {
    id: 'clock', name: 'Clock', icon: '🕰️', color: '#5f3dc4', cat: 'town', render: renderClock,
    does: 'Game time and what’s open.',
    about: 'See the time of day and which places are open. At night, vote to skip to morning.',
    badge: (app) => (app.store.vote?.active ? '🗳' : null),
  },
  {
    id: 'radio', name: 'Radio', icon: '📻', color: '#0c8599', cat: 'town', render: renderRadio,
    does: 'Music for everyone.',
    about: 'Everyone hears the same song. Vote to skip it or switch the genre.',
  },
  {
    id: 'handbook', name: 'Handbook', icon: '📘', color: '#1971c2', cat: 'town', render: renderHandbook,
    does: 'How to play.',
    about: 'Step-by-step guides and every tip in the game. Start here if you are stuck.',
  },
  {
    id: 'settings', name: 'Settings', icon: '⚙️', color: '#495057', cat: 'town', open: (app) => app.openSettings(), stacks: true,
    does: 'Sound, music and options.',
    about: 'Change the volume, music, effects and tips.',
  },
];

export const appById = (id: string | null | undefined) => (id ? APPS.find((a) => a.id === id) : undefined);
export const categoryOf = (a: PhoneApp) => CATEGORIES.find((c) => c.id === a.cat)!;
