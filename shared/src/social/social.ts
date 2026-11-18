// Phase 7 social economy: trading, gifting and leaderboards (types shared by server and client).
import type { InventoryItem } from '../protocol/messages';

/** One side of a trade: what they put in. */
export interface TradeSide {
  player: number;
  name: string;
  items: InventoryItem[];
  sen: number;
  /** Happy with the offer (any change unlocks both). */
  locked: boolean;
  /** Pressed the final confirm (only once both are locked). */
  confirmed: boolean;
}

export interface TradeView {
  id: number;
  /** Your side first. */
  me: TradeSide;
  them: TradeSide;
}

export const LEADERBOARDS = [
  { id: 'netWorth', name: 'Net worth', icon: '💰', money: true },
  { id: 'rarest', name: 'Rarest pull', icon: '🌟', money: false },
  { id: 'collection', name: 'Collection', icon: '📖', money: false },
  { id: 'airbnb', name: 'Airbnb rating', icon: '🛏️', money: false },
  { id: 'cooking', name: 'Perfect dishes', icon: '🍳', money: false },
  { id: 'casinoWin', name: 'Biggest casino win', icon: '🎰', money: true },
  { id: 'casinoLoss', name: 'Biggest casino loss', icon: '💸', money: true },
  { id: 'level', name: 'Level', icon: '⭐', money: false },
] as const;
export type BoardId = (typeof LEADERBOARDS)[number]['id'];

/** A player's numbers for every board (kept for offline players too). */
export interface BoardEntry {
  player: number;
  name: string;
  online: boolean;
  scores: Record<BoardId, number>;
  /** Shown next to the score (e.g. the rarest item's name). */
  notes?: Partial<Record<BoardId, string>>;
}
