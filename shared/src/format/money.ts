// Money is always integer sen (1 RM = 100 sen). These helpers only format for display.

const UNITS: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e4, 'K'], // short format kicks in from RM 10K; below that we show RM 1,250
];

/** Short display: RM 1,250 → RM 12.5K → RM 3.4M → RM 1.2B → RM 5T */
export function formatMoney(sen: number): string {
  const sign = sen < 0 ? '-' : '';
  const rm = Math.abs(sen) / 100;
  for (const [size, suffix] of UNITS) {
    if (rm >= size) {
      const div = suffix === 'K' ? 1e3 : size;
      const v = rm / div;
      const txt = v >= 100 ? Math.floor(v).toString() : (Math.floor(v * 10) / 10).toString();
      return `${sign}RM ${txt}${suffix}`;
    }
  }
  return `${sign}RM ${Math.floor(rm).toLocaleString('en-US')}`;
}

/** Exact display with sen: RM 1,250.50 */
export function formatMoneyExact(sen: number): string {
  const sign = sen < 0 ? '-' : '';
  const abs = Math.abs(sen);
  const rm = Math.floor(abs / 100);
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${sign}RM ${rm.toLocaleString('en-US')}.${cents}`;
}
