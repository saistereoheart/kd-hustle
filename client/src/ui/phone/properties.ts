// 📱 Properties: your homes. Choose what each one does (rent / Airbnb / live in it), set rent or
// the nightly price against the fair range, see tenants, happiness, maintenance, guests, reviews
// and stars, hire a manager or a cleaner, or sell.
import { formatMoney, type PropertyMode } from '@kh/shared';
import type { PhoneCtx } from './phone';
import { el, toast } from '../dom';
import { sfx } from '../sound';

export function renderProperties({ app, rerender }: PhoneCtx): HTMLElement[] {
  const mine = app.store.myProps;
  if (!mine.length)
    return [
      el('p', { class: 'empty' }, 'You don\'t own a home yet.'),
      el('p', { class: 'hint' }, 'Walk up to a condo, terrace or semi-D with a 🏷️ FOR SALE sign and press E. Studios in Ant Palms are the cheapest start.'),
    ];
  const send = <K extends 'prop:mode' | 'prop:prices' | 'prop:staff' | 'prop:sell'>(ev: K, msg: unknown, okText?: string) =>
    (app.socket as unknown as { timeout: (n: number) => { emit: (e: string, m: unknown, cb: (err: unknown, res: { ok: boolean; error?: string; gainedSen?: number }) => void) => void } })
      .timeout(5000)
      .emit(ev, msg, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          return void toast(err ? 'No response.' : (res.error ?? ''), 'bad');
        }
        if (okText) toast(okText, 'good');
        rerender();
      });
  return mine.map((s) => {
    const u = app.listings.find((x) => x.id === s.unit);
    const t = app.cfg.properties.types[s.type];
    const b = app.map.buildings.find((x) => x.id === u?.building);
    const head = el('div', { class: 'prop-head' }, el('b', {}, `${t.icon} ${t.name}${u && u.n > 1 ? ` · unit ${u.n}` : ''}`), el('span', { class: 'muted small' }, b?.name ?? ''));
    const modes: Array<[PropertyMode, string]> = [['rent', '🏠 Rent out'], ['airbnb', '🛏️ Airbnb'], ['home', '🛋️ Live in it'], ['none', '⏸ Empty']];
    const modeRow = el('div', { class: 'seg' }, ...modes.map(([m, label]) => {
      const bt = el('button', { class: `btn small${s.mode === m ? ' primary' : ''}`, type: 'button', 'data-mode': m }, label);
      bt.addEventListener('click', () => send('prop:mode', { unit: s.unit, mode: m }));
      return bt;
    }));
    const lines: HTMLElement[] = [];
    const priceInput = (label: string, valueSen: number, fairSen: number, key: 'rentSen' | 'nightSen') => {
      const inp = el('input', { type: 'number', min: '1', step: '1', value: String(Math.round(valueSen / 100)), class: 'price-input', 'data-price': key });
      const set = el('button', { class: 'btn small', type: 'button' }, 'Set');
      set.addEventListener('click', () => send('prop:prices', { unit: s.unit, [key]: Math.round(Number(inp.value) * 100) }, 'Price updated.'));
      return el('div', { class: 'setting-row' }, el('span', {}, `${label} (fair ${formatMoney(Math.round(fairSen * 0.9))}–${formatMoney(Math.round(fairSen * 1.1))})`), el('span', {}, 'RM ', inp, set));
    };
    // ✨ Better furniture (tier, variants) pays more rent and Airbnb income.
    const furnBonus = () => (s.rating.payBonus > 0 ? el('div', { class: 'muted small', title: 'The average tier and variant of the furniture placed here' }, `✨ Furniture quality ×${s.rating.quality.toFixed(2)}: +${(s.rating.payBonus * 100).toFixed(1)}% income`) : null);
    if (s.mode === 'rent') {
      lines.push(priceInput('Rent per day', s.rentSen, s.fairRentSen, 'rentSen'));
      const fb = furnBonus();
      if (fb) lines.push(fb);
      if (s.tenant) {
        const def = app.cfg.properties.rent.tenants.find((x) => x.id === s.tenant!.kind);
        const fee = Math.round(s.rentSen * app.cfg.properties.rent.evictFeeDays);
        const evict = el('button', { class: 'btn small danger', type: 'button', 'data-action': 'evict' }, '🚪 Ask to leave');
        evict.addEventListener('click', () => {
          if (!confirm(`Ask your ${def?.name.toLowerCase() ?? 'tenant'} to move out? You pay them ${formatMoney(fee)} (a day's rent)${s.tenant!.owed ? ` and the ${formatMoney(s.tenant!.owed)} they owe is written off` : ''}. Then a new tenant can move in, or switch the home to Airbnb.`)) return;
          app.socket?.timeout(5000).emit('prop:evict', { unit: s.unit }, (err, res) => {
            if (err || !res.ok) {
              sfx.error();
              return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
            }
            toast('🚪 Your tenant moved out.', 'good');
            rerender();
          });
        });
        lines.push(el('div', { class: 'setting-row' }, el('span', {}, `${def?.icon ?? '🙂'} Tenant: ${def?.name ?? s.tenant.kind} · happiness ${s.happiness ?? 0}%${s.tenant.owed ? ` · owes ${formatMoney(s.tenant.owed)}` : ''}`), el('span', {}, evict, el('div', { class: 'muted small' }, `costs ${formatMoney(fee)}`))));
      } else lines.push(el('div', { class: 'muted' }, '🔎 Looking for a tenant… (lower rent = faster)'));
      lines.push(el('div', { class: 'muted small' }, `Condition ${Math.round(s.condition)}%`));
      for (const r of s.requests) {
        const fix = el('button', { class: 'btn small', type: 'button' }, `Contractor ${formatMoney(Math.round(s.boughtSen * app.cfg.properties.costs.contractorRate))}`);
        fix.addEventListener('click', () =>
          app.socket?.timeout(5000).emit('prop:fix', { unit: s.unit, req: r.id, how: 'contractor' }, (err, res) => {
            if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
            toast('🔧 Fixed by the contractor.', 'good');
          }),
        );
        lines.push(el('div', { class: 'setting-row' }, el('span', {}, `🔧 ${r.text}`), el('span', {}, fix, el('span', { class: 'muted small' }, ' or fix it yourself inside'))));
      }
    } else if (s.mode === 'airbnb') {
      lines.push(el('div', { class: 'deco-stars small-stars' }, `${s.rating.stars.toFixed(1)}★ ${s.superhost ? '🏅 Superhost' : ''}`));
      if (s.rating.missing.length) lines.push(el('div', { class: 'deco-missing' }, `Missing essentials: ${s.rating.missing.join(', ')}`));
      lines.push(priceInput('Per night', s.nightSen, s.fairNightSen, 'nightSen'));
      const fb = furnBonus();
      if (fb) lines.push(fb);
      lines.push(el('div', {}, s.guest ? `🧳 Guest staying${s.guest.vip ? ' (VIP!)' : ''} · pays ${formatMoney(s.guest.paySen)}` : '🛎️ Waiting for a booking'));
      lines.push(el('div', { class: 'muted small' }, `Cleanliness ${Math.round(s.cleanliness)}% · ${s.fiveStars} five-star reviews`));
      if (s.suggestions[0]) lines.push(el('div', { class: 'deco-sugg' }, `💡 ${s.suggestions[0].text} → ${s.suggestions[0].gain > 0 ? `+${s.suggestions[0].gain.toFixed(1)}★` : 'a small boost'}`));
      for (const r of s.reviews.slice(0, 3)) lines.push(el('div', { class: 'review' }, `${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} “${r.text}”`));
    } else if (s.mode === 'home') lines.push(el('div', { class: 'muted' }, 'Your own place: decorate it and show it off.'));
    else lines.push(el('div', { class: 'muted' }, 'Empty. Pick what to do with it above.'));
    lines.push(el('div', { class: 'muted small' }, '🛋️ Furnish it: go in and tap 🛠️ Decorate. Buy furniture at IKEJA (🛋️ on the map).'));
    const staff = el('div', { class: 'seg' });
    for (const role of ['manager', 'cleaner'] as const) {
      if (role === 'manager' && s.mode !== 'rent') continue;
      if (role === 'cleaner' && s.mode !== 'airbnb') continue;
      const on = s[role];
      const bt = el('button', { class: `btn small${on ? ' primary' : ''}`, type: 'button' }, role === 'manager' ? `👔 Manager ${on ? 'on' : 'off'} (${Math.round(app.cfg.properties.costs.managerCut * 100)}% cut)` : `🧹 Cleaner ${on ? 'on' : 'off'}`);
      bt.addEventListener('click', () => send('prop:staff', { unit: s.unit, role, on: !on }));
      staff.append(bt);
    }
    const go = el('button', { class: 'btn small', type: 'button' }, '📍 Take me there');
    go.addEventListener('click', () => u && app.guide?.pointAt({ id: s.unit, label: 'YOUR HOME', icon: '🏠', x: u.x, y: u.y }));
    const sell = el('button', { class: 'btn small danger', type: 'button' }, `Sell (${formatMoney(Math.floor(s.boughtSen * app.cfg.properties.sellBackRate))})`);
    sell.addEventListener('click', () => {
      if (confirm('Sell this home? Furniture stays in your bag.')) send('prop:sell', { unit: s.unit }, '🏷️ Sold.');
    });
    return el(
      'div',
      { class: 'prop-card', 'data-unit': s.unit },
      head,
      modeRow,
      ...lines,
      staff,
      el('div', { class: 'muted small' }, `Earned so far: ${formatMoney(s.earnedSen)}`),
      el('div', { class: 'actions' }, go, sell),
    );
  });
}
