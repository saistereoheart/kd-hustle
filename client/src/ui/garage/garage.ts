// 🚗 Motor Kota, the windows: the showroom (walk in to buy: cars and bikes with a big preview,
// the spec sheet and a "hear it" rev) and your garage (📱 Garage, anywhere: ride it, put it on
// the hotbar, tune the engine / torque / tyres, repaint, new wheel colour, fit an exhaust and
// hear it). The server owns prices and what you own; this shows GarageView and sends intents.
import { formatMoney, GARAGE_PARTS, partCostSen, type GaragePart, type GarageView, type VehicleLook } from '@kh/shared';
import type { App } from '../../app';
import { drawShowroomVehicle, resolveLook, viewSize, type View } from '../../items/carArt';
import { el, toast } from '../dom';
import { revDemo } from '../engineSound';
import { openPanel, tabs } from '../panel';
import { sfx } from '../sound';

/** px/s → km/h (2 m per 32 px tile). */
const kmh = (pxPerSec: number) => Math.round((pxPerSec / 16) * 3.6);

const PART_ICON: Record<GaragePart, string> = { engine: '🔧', torque: '⚡', tires: '🛞' };

/** A vehicle drawn big on a canvas. */
export function vehicleCanvas(id: string, look: VehicleLook | null, view: View, width: number): HTMLCanvasElement {
  const size = viewSize(id, view);
  // Every view shares one canvas size (the 3D model turned), so one scale fits them all.
  const scale = width / size.w;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const c = el('canvas', { class: 'vehicle-preview' }) as HTMLCanvasElement;
  c.width = Math.round(size.w * scale * dpr);
  c.height = Math.round(size.h * scale * dpr);
  c.style.width = `${Math.round(size.w * scale)}px`;
  c.style.height = `${Math.round(size.h * scale)}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale * dpr, scale * dpr);
  drawShowroomVehicle(ctx, id, resolveLook(id, look), view);
  return c;
}

type Garage = { owned: GarageView['owned'] };
type Reply = { ok: true; view: GarageView; vehicles?: string[] } | { ok: false; error: string };
interface LooseSocket {
  timeout(ms: number): { emit(ev: string, ...args: unknown[]): void };
}
function send(app: App, ev: 'garage:buy' | 'garage:upgrade' | 'garage:style', msg: unknown, done: (v: GarageView) => void) {
  const sock = app.socket as unknown as LooseSocket | null;
  sock?.timeout(6000).emit(ev, msg, (err: unknown, res: Reply) => {
    if (err || !res.ok) {
      sfx.error();
      return void toast(err ? 'No reply from the server.' : !res.ok ? res.error : '', 'bad');
    }
    app.store.garage = res.view;
    if (res.vehicles) app.store.vehicles = res.vehicles;
    app.store.emit();
    done(res.view);
  });
}
function fetchGarage(app: App, done: (v: Garage) => void) {
  app.socket?.timeout(6000).emit('garage:view', (err, res) => {
    if (err || !res.ok) return;
    app.store.garage = res.view;
    done(res.view);
  });
}

let stopSound: (() => void) | null = null;
function hear(app: App, id: string, exhaust: string) {
  stopSound?.();
  stopSound = revDemo(app.cfg.garage, id, exhaust);
}

function specs(app: App, id: string): HTMLElement {
  const m = app.cfg.garage.models[id];
  const v = app.cfg.vehicles.vehicles[id];
  const e = m.engine;
  const row = (k: string, val: string) => el('div', { class: 'spec-row' }, el('span', {}, k), el('b', {}, val));
  return el('div', { class: 'spec-sheet' },
    row('Engine', `${e.cc} cc ${e.layout}${e.turbo ? '' : ''}`),
    row('Cylinders', `${e.cylinders}`),
    row('Redline', `${e.redline.toLocaleString()} rpm`),
    row('Gears', `${e.gears}`),
    row('Top speed', `${kmh(v?.speed ?? 0)} km/h`),
    row('0 → top', `${m.accelSec.toFixed(1)} s`),
  );
}

// ------------------------------------------------------------------ the showroom
export function openShowroom(app: App) {
  const g = app.cfg.garage;
  const panel = openPanel(`🚗 ${g.name} Showroom`, { wide: true, testId: 'showroom-panel', cls: 'showroom-panel' });
  const side = panel.side('🔑 Your garage');
  let kind: 'car' | 'bike' = 'car';
  const list = el('div', { class: 'showroom-list' });

  function paintSide() {
    const owned = Object.keys(app.store.garage?.owned ?? {});
    const go = el('button', { class: 'btn primary', type: 'button', 'data-action': 'open-garage' }, '🔧 Open my garage');
    go.addEventListener('click', () => openGarage(app));
    side.replaceChildren(
      el('div', { class: 'dungeon-stat' }, el('span', {}, '💰 Cash'), el('b', {}, formatMoney(app.store.walletSen))),
      ...(owned.length
        ? owned.map((id) => el('div', { class: 'muted small' }, `✓ ${g.models[id].maker} ${g.models[id].model}`))
        : [el('p', { class: 'muted small' }, 'Nothing yet. Tap a car or bike to hear it, then buy it here.')]),
      ...(owned.length ? [go] : []),
      el('p', { class: 'muted small' }, 'Tune it, repaint it and fit a louder exhaust in 📱 Garage (anywhere).'),
    );
  }

  function paint() {
    const ids = Object.keys(g.models).filter((id) => g.models[id].kind === kind);
    list.replaceChildren(...ids.map((id) => {
      const m = g.models[id];
      const owned = !!app.store.garage?.owned[id];
      const buy = el('button', { class: `btn ${owned ? '' : 'primary'}`, type: 'button', 'data-action': `buy-${id}`, disabled: owned }, owned ? '✓ Owned' : `Buy ${formatMoney(m.priceSen)}`);
      buy.addEventListener('click', () => {
        if (app.store.walletSen < m.priceSen) return void toast(`Not enough money: it's ${formatMoney(m.priceSen)}.`, 'bad');
        if (!confirm(`Buy the ${m.maker} ${m.model} for ${formatMoney(m.priceSen)}?`)) return;
        send(app, 'garage:buy', { model: id }, () => {
          sfx.coin();
          sfx.levelUp();
          toast(`🔑 The ${m.maker} ${m.model} is yours! It's on your hotbar: tap it to ride.`, 'good', 5000);
          const free = app.store.hotbar.findIndex((h) => !h);
          if (free >= 0) app.setHotbarSlot(free, { kind: 'vehicle', id });
          paint();
          paintSide();
        });
      });
      const listen = el('button', { class: 'btn small', type: 'button', 'data-action': `hear-${id}` }, '🔊 Hear it');
      listen.addEventListener('click', () => hear(app, id, 'stock'));
      return el('div', { class: `showroom-card${owned ? ' owned' : ''}` },
        el('div', { class: 'showroom-stage' }, vehicleCanvas(id, null, 'side', m.kind === 'car' ? 260 : 210)),
        el('div', { class: 'showroom-info' },
          el('h4', {}, `${m.maker} ${m.model}`),
          el('div', { class: 'muted small' }, m.desc),
          specs(app, id),
          el('div', { class: 'dungeon-controls' }, listen, buy)),
      );
    }));
  }

  const bar = tabs(['🚗 Cars', '🏍️ Bikes'], (i) => {
    kind = i === 0 ? 'car' : 'bike';
    stopSound?.();
    paint();
  });
  panel.body.replaceChildren(bar, list);
  panel.onClose = () => stopSound?.();
  panel.onResume = () => {
    paint();
    paintSide();
  };
  paint();
  paintSide();
  fetchGarage(app, () => {
    paint();
    paintSide();
  });
}

// ------------------------------------------------------------------ your garage
export function openGarage(app: App, focus?: string) {
  const g = app.cfg.garage;
  const panel = openPanel('🔧 My Garage', { wide: true, testId: 'garage-panel', cls: 'showroom-panel' });
  let sel = focus ?? null;
  let view: View = 'side';
  let tab = 0;

  function goToShowroom() {
    const it = app.map.interactables.find((i) => i.type === 'showroom');
    if (!it) return;
    panel.closeAll();
    const [x, y] = it.spots[0] ?? [it.x, it.y]; // its door
    app.guide?.pointAt({ id: 'showroom', label: 'CARS & BIKES', icon: '🚗', x, y });
  }

  function paint() {
    const owned = app.store.garage?.owned ?? {};
    const ids = Object.keys(owned);
    if (!ids.length) {
      const go = el('button', { class: 'btn primary', type: 'button', 'data-action': 'garage-showroom' }, `📍 Take me to the ${g.name} Showroom`);
      go.addEventListener('click', goToShowroom);
      panel.body.replaceChildren(el('div', { class: 'empty' },
        el('div', { class: 'pet-empty-icon' }, '🚗'),
        el('p', {}, `No car or superbike yet. Visit the ${g.name} Showroom to buy one: Protan, Peroduo, Kawasaky, Dukati and more.`), go));
      return;
    }
    if (!sel || !owned[sel]) sel = ids[0];
    const id = sel;
    const s = owned[id];
    const m = g.models[id];
    // Pick which of your vehicles
    const picker = el('div', { class: 'garage-picker' }, ...ids.map((x) => {
      const b = el('button', { class: `btn small${x === id ? ' primary' : ''}`, type: 'button', 'data-action': `garage-pick-${x}` }, `${g.models[x].kind === 'car' ? '🚗' : '🏍️'} ${g.models[x].model}`);
      b.addEventListener('click', () => {
        sel = x;
        stopSound?.();
        paint();
      });
      return b;
    }));
    // The car on stage (side / front / back)
    const look: VehicleLook = { paint: s.paint, wheel: s.wheel, exhaust: s.exhaust };
    const views = el('div', { class: 'garage-views' }, ...(['side', 'front', 'back'] as const).map((v) => {
      const b = el('button', { class: `btn small${v === view ? ' primary' : ''}`, type: 'button' }, v === 'side' ? 'Side' : v === 'front' ? 'Front' : 'Back');
      b.addEventListener('click', () => {
        view = v;
        paint();
      });
      return b;
    }));
    const riding = app.store.riding === id;
    const ride = el('button', { class: 'btn primary', type: 'button', 'data-action': 'garage-ride' }, riding ? '🅿️ Park it (get off)' : '🔑 Ride it now');
    ride.addEventListener('click', () => {
      app.ride(riding ? null : id);
      window.setTimeout(paint, 400);
    });
    const onBar = app.store.hotbar.findIndex((h) => h?.kind === 'vehicle' && h.id === id);
    const hot = el('button', { class: 'btn', type: 'button', 'data-action': 'garage-hotbar' }, onBar >= 0 ? `On hotbar (${(onBar + 1) % 10})` : 'Add to hotbar');
    hot.addEventListener('click', () => {
      if (onBar >= 0) return;
      const free = app.store.hotbar.findIndex((h) => !h);
      if (free < 0) return void toast('Hotbar is full. Right-click (or long-press) a slot to clear it.', 'bad');
      app.setHotbarSlot(free, { kind: 'vehicle', id });
      window.setTimeout(paint, 400);
    });
    const listen = el('button', { class: 'btn', type: 'button', 'data-action': 'garage-hear' }, '🔊 Rev it');
    listen.addEventListener('click', () => hear(app, id, s.exhaust));

    const stage = el('div', { class: 'garage-stage' },
      el('h4', {}, `${m.maker} ${m.model}`),
      vehicleCanvas(id, look, view, m.kind === 'car' ? 320 : 250),
      views,
      el('div', { class: 'garage-stats' },
        el('span', {}, `🏁 ${kmh(s.speed)} km/h`),
        el('span', {}, `⏱️ 0 → top ${s.accelSec.toFixed(2)} s`),
        el('span', {}, `🛞 grip +${Math.round(g.upgrades.tires.per * s.tires * 100)}% off-road`)),
      el('div', { class: 'dungeon-controls' }, ride, hot, listen),
    );

    // Tabs: performance / paint / wheels / exhaust
    const content = el('div', { class: 'garage-tab' });
    const swatch = (color: string, name: string, price: number, on: boolean, act: string, click: () => void) => {
      const b = el('button', { class: `swatch-btn${on ? ' on' : ''}`, type: 'button', 'data-action': act, title: `${name}${price ? ` · ${formatMoney(price)}` : ''}` },
        el('i', { class: 'swatch' }), el('span', {}, name), el('small', {}, on ? '✓ fitted' : formatMoney(price)));
      (b.querySelector('.swatch') as HTMLElement).style.background = color;
      b.addEventListener('click', () => !on && click());
      return b;
    };
    const style = (kind: 'paint' | 'wheel' | 'exhaust', choice: string, price: number, label: string) => {
      if (price && app.store.walletSen < price) return void toast('Not enough money.', 'bad');
      send(app, 'garage:style', { model: id, kind, id: choice }, () => {
        sfx.click();
        toast(`${label} ✓`, 'good');
        if (kind === 'exhaust') hear(app, id, choice);
        paint();
      });
    };
    if (tab === 0) {
      content.append(...GARAGE_PARTS.map((part) => {
        const u = g.upgrades[part];
        const lvl = s[part];
        const cost = partCostSen(g, id, part, lvl);
        const b = el('button', { class: 'btn small', type: 'button', 'data-action': `garage-up-${part}`, disabled: cost === null }, cost === null ? 'MAX' : `Upgrade · ${formatMoney(cost)}`);
        b.addEventListener('click', () => {
          if (cost !== null && app.store.walletSen < cost) return void toast('Not enough money.', 'bad');
          send(app, 'garage:upgrade', { model: id, part }, () => {
            sfx.levelUp();
            paint();
          });
        });
        const what = part === 'engine' ? `+${Math.round(u.per * 100)}% top speed` : part === 'torque' ? `+${Math.round(u.per * 100)}% acceleration` : `+${Math.round(u.per * 100)}% grip on grass & dirt`;
        const pips = el('span', { class: 'pet-pips' }, ...Array.from({ length: u.maxLevel }, (_, i) => el('i', { class: i < lvl ? 'on' : '' })));
        return el('div', { class: 'pet-stat garage-part' }, el('span', { class: 'pet-stat-name' }, `${PART_ICON[part]} ${u.name}`), el('small', { class: 'muted' }, what), pips, b);
      }));
    } else if (tab === 1) {
      content.append(el('div', { class: 'swatches' }, ...Object.entries(g.paints).map(([pid, p]) => swatch(p.color, p.name, p.priceSen, s.paint === pid, `paint-${pid}`, () => style('paint', pid, p.priceSen, `🎨 ${p.name}`)))));
    } else if (tab === 2) {
      content.append(el('div', { class: 'swatches' }, ...Object.entries(g.wheels).map(([wid, w]) => swatch(w.color, w.name, w.priceSen, s.wheel === wid, `wheel-${wid}`, () => style('wheel', wid, w.priceSen, `🛞 ${w.name} wheels`)))));
    } else {
      content.append(...Object.entries(g.exhausts).map(([xid, x]) => {
        const have = s.exhausts.includes(xid);
        const on = s.exhaust === xid;
        const fit = el('button', { class: `btn small${on ? '' : ' primary'}`, type: 'button', 'data-action': `exhaust-${xid}`, disabled: on }, on ? '✓ Fitted' : have ? 'Fit (owned)' : `Buy & fit · ${formatMoney(x.priceSen)}`);
        fit.addEventListener('click', () => style('exhaust', xid, have ? 0 : x.priceSen, `💨 ${x.name}`));
        const demo = el('button', { class: 'btn small', type: 'button', 'data-action': `exhaust-hear-${xid}` }, '🔊');
        demo.addEventListener('click', () => hear(app, id, xid));
        return el('div', { class: 'exhaust-row' },
          el('div', { class: 'grow' }, el('b', {}, `${x.name}${x.speed ? ` · +${Math.round(x.speed * 100)}% speed` : ''}`), el('div', { class: 'muted small' }, x.desc)), demo, fit);
      }));
    }
    const bar = tabs(['⚙️ Performance', '🎨 Paint', '🛞 Wheels', '💨 Exhaust'], (i) => {
      tab = i;
      paint();
    }, tab);
    panel.body.replaceChildren(picker, el('div', { class: 'garage-layout' }, stage, el('div', { class: 'garage-right' }, bar, content)));
  }

  panel.onClose = () => stopSound?.();
  panel.onResume = paint;
  paint();
  fetchGarage(app, paint);
}
