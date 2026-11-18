// Pasar Online (spec §14): the marketplace. List items at a fixed price or as an auction
// (in-game hours); a fee on every sale is a money sink; price history per item.
import { z } from 'zod';

export const marketConfigSchema = z.object({
  name: z.string(),
  requires: z.object({ stage: z.number().int().positive().optional() }).default({}),
  feeRate: z.number().min(0).max(1),
  maxListings: z.number().int().positive(),
  /** A new bid must beat the top bid by this share. */
  minBidStep: z.number().min(0),
  /** Auction lengths you can pick (in-game hours). */
  auctionHours: z.array(z.number().positive()).min(1),
  /** A bid this close to the end extends the auction to this long. */
  antiSnipeMs: z.number().int().nonnegative(),
  maxPriceSen: z.number().int().positive(),
  historySize: z.number().int().positive(),
});
export type MarketConfig = z.infer<typeof marketConfigSchema>;

export interface MarketListing {
  id: number;
  seller: number;
  sellerName: string;
  itemId: string;
  variant: string;
  grade: string;
  serial: number | null;
  kind: 'fixed' | 'auction';
  /** Fixed: the price. Auction: the starting price. */
  priceSen: number;
  topBidSen: number;
  topBidder: number | null;
  topBidderName: string | null;
  /** Auctions: when it closes (server ms). */
  endsAt: number | null;
  listedAt: number;
}

export interface MarketSale {
  itemId: string;
  variant: string;
  grade: string;
  priceSen: number;
  kind: 'fixed' | 'auction';
  at: number;
}

/** The lowest next bid on an auction. */
export function minNextBid(cfg: MarketConfig, l: Pick<MarketListing, 'priceSen' | 'topBidSen' | 'topBidder'>): number {
  if (l.topBidder === null) return l.priceSen;
  return Math.max(l.topBidSen + 100, Math.ceil((l.topBidSen * (1 + cfg.minBidStep)) / 100) * 100);
}
