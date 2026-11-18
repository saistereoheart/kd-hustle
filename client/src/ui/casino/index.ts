// The Lucky Strand Casino's games, opened from their stations inside the casino.
import type { App } from '../../app';
import { openBlackjack } from './blackjack';
import { openHighLow, openSlots } from './solo';
import { openCrash, openRoulette, openWheel } from './tables';

export function openCasinoGame(app: App, game: string) {
  if (game === 'slots') openSlots(app);
  else if (game === 'highlow') openHighLow(app);
  else if (game === 'roulette') openRoulette(app);
  else if (game === 'wheel') openWheel(app);
  else if (game === 'crash') openCrash(app);
  else if (game === 'blackjack') openBlackjack(app);
}
