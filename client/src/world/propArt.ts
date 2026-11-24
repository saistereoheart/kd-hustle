// 🏬 Art for the designed interiors' props (pawn counters, gacha machines, shop lots, aisles, freezers…),
// drawn with Phaser Graphics around a centre and baked once per kind / size / colour (see bake.ts), so a
// mall full of them is a handful of shared pictures.
import type Phaser from 'phaser';
import type { PlanProp } from '@kh/shared';
import { drawFurniture, T } from './interiorArt';

const hex = (c: string | undefined, d: number) => (c ? parseInt(c.slice(1), 16) : d);
/** A colour a bit lighter / darker. */
function shade(c: number, k: number): number {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

/** A box seen from above at 3/4: its top, and the front face below it. */
function box(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, col: number, front = 0.28) {
  const fh = Math.min(h * front, 12);
  g.fillStyle(0x000000, 0.2).fillRoundedRect(x + 3, y + 5, w, h, 5);
  g.fillStyle(shade(col, -0.35), 1).fillRoundedRect(x, y + h - fh, w, fh, 4);
  g.fillStyle(col, 1).fillRoundedRect(x, y, w, h - fh + 2, 4);
  g.fillStyle(shade(col, 0.25), 1).fillRect(x + 3, y + 3, w - 6, 3);
}

export function drawProp(g: Phaser.GameObjects.Graphics, p: Pick<PlanProp, 'kind' | 'w' | 'h' | 'color' | 'face'>, cx: number, cy: number, accent: number) {
  const w = p.w * T, h = p.h * T, x = cx - w / 2, y = cy - h / 2;
  const col = hex(p.color, accent);
  const long = w >= h; // runs left–right (else up–down)
  switch (p.kind) {
    case 'counter':
      box(g, x, y, w, h, col);
      return;
    case 'grille': {
      box(g, x, y, w, h, col);
      // Bars up from the counter top (a pawn shop's grille).
      g.lineStyle(2, 0xadb5bd, 0.95);
      const n = Math.max(2, Math.round((long ? w : h) / 9));
      for (let i = 0; i <= n; i++) {
        if (long) g.lineBetween(x + (w * i) / n, y + 2, x + (w * i) / n, y - 0.9 * T);
        else g.lineBetween(x + 2, y + (h * i) / n, x + 2, y + (h * i) / n - 0.9 * T);
      }
      g.lineStyle(3, 0x868e96, 1).lineBetween(x, y - 0.9 * T, x + (long ? w : 4), y - 0.9 * T + (long ? 0 : h));
      return;
    }
    case 'glasscase':
    case 'display': {
      box(g, x, y, w, h, 0x8d6e63);
      g.fillStyle(0xd0ebff, 0.85).fillRoundedRect(x + 4, y + 4, w - 8, h * 0.6, 3);
      const dots = [0xfcc419, 0xe9ecef, 0x63e6be, 0xff8787, 0xffd43b];
      const n = Math.max(3, Math.round(((long ? w : h) / T) * 2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        g.fillStyle(dots[i % dots.length], 1).fillCircle(long ? x + 6 + t * (w - 12) : x + w / 2 + (i % 2 ? 4 : -4), long ? y + 6 + (i % 2) * 6 : y + 6 + t * (h * 0.6 - 10), 2.5);
      }
      return;
    }
    case 'safe':
      box(g, x, y, w, h, 0x343a40, 0.45);
      g.lineStyle(2, 0xadb5bd, 1).strokeCircle(cx, cy - 2, Math.min(w, h) * 0.2);
      g.fillStyle(0xfcc419, 1).fillRect(cx + Math.min(w, h) * 0.25, cy - 3, 5, 3);
      return;
    case 'board':
    case 'notice':
    case 'directory':
    case 'poster':
    case 'banner': {
      // A board on two legs, its face in colour.
      g.fillStyle(0x000000, 0.2).fillEllipse(cx, y + h + 2, w * 0.9, 6);
      g.fillStyle(0x495057, 1).fillRect(x + 4, y + h * 0.4, 3, h * 0.6 + 4).fillRect(x + w - 7, y + h * 0.4, 3, h * 0.6 + 4);
      const fh = Math.max(h, 0.55 * T);
      g.fillStyle(p.kind === 'directory' ? 0x1c7ed6 : col, 1).fillRoundedRect(x, y - fh * 0.6, w, fh, 4);
      g.fillStyle(0xffffff, 0.85).fillRoundedRect(x + 3, y - fh * 0.6 + 3, w - 6, fh - 6, 3);
      if (p.kind === 'directory') {
        const cs = [0xff8787, 0x69db7c, 0x4dabf7, 0xffd43b, 0xda77f2];
        for (let i = 0; i < 5; i++) g.fillStyle(cs[i], 1).fillRect(x + 6 + i * ((w - 12) / 5), y - fh * 0.6 + 6, (w - 12) / 5 - 2, fh - 12);
      } else g.fillStyle(col, 0.9).fillRect(x + 6, y - fh * 0.6 + 6, w - 12, 3);
      return;
    }
    case 'ticket':
      g.fillStyle(0x000000, 0.2).fillEllipse(cx, y + h, w, 5);
      g.fillStyle(0xc92a2a, 1).fillRoundedRect(cx - 7, y - 0.4 * T, 14, h + 0.4 * T, 4);
      g.fillStyle(0xffffff, 1).fillRect(cx - 4, y - 0.4 * T + 5, 8, 6);
      return;
    case 'gacha': {
      // A small capsule machine: coloured base, a glass dome of capsules, a crank.
      g.fillStyle(0x000000, 0.2).fillEllipse(cx + 2, y + h + 1, w * 0.95, 8);
      g.fillStyle(col, 1).fillRoundedRect(x + 3, cy, w - 6, h / 2, 5);
      g.fillStyle(shade(col, -0.35), 1).fillRect(x + 3, y + h - 5, w - 6, 5);
      g.fillStyle(0xe7f5ff, 0.9).fillCircle(cx, cy - 2, w * 0.38);
      const cs = [0xff6b6b, 0xffd43b, 0x4dabf7, 0x69db7c, 0xda77f2];
      for (let i = 0; i < 6; i++) g.fillStyle(cs[i % 5], 1).fillCircle(cx - w * 0.18 + (i % 3) * w * 0.18, cy - 6 + Math.floor(i / 3) * 7, 3.2);
      g.lineStyle(2, 0xffffff, 0.7).strokeCircle(cx, cy - 2, w * 0.38);
      g.fillStyle(0xf8f9fa, 1).fillCircle(cx, cy + h * 0.28, 3.5);
      return;
    }
    case 'changer':
      box(g, x, y, w, h, 0x868e96, 0.4);
      g.fillStyle(0x12b886, 1).fillRect(x + 6, y + 5, w - 12, 7);
      g.fillStyle(0x212529, 1).fillRect(cx - 6, y + h * 0.45, 12, 3);
      return;
    case 'bin':
      g.fillStyle(0x000000, 0.2).fillEllipse(cx, y + h, w, 6);
      g.fillStyle(0x2f9e44, 1).fillRoundedRect(x + 2, y, w - 4, h, 5);
      g.fillStyle(0x51cf66, 1).fillEllipse(cx, y + 2, w - 4, 6);
      return;
    case 'lot': {
      // A shop lot: its floor, the shopfront frame in its colour, the counter on the side facing the
      // shoppers, an awning at the back with the menu / goods.
      const face = p.face ?? 'down';
      g.fillStyle(0x000000, 0.18).fillRoundedRect(x + 3, y + 5, w, h, 6);
      g.fillStyle(shade(col, 0.82), 1).fillRoundedRect(x, y, w, h, 6);
      g.lineStyle(4, col, 1).strokeRoundedRect(x + 2, y + 2, w - 4, h - 4, 6);
      const ct = 0.75 * T, bk = 0.7 * T;
      const stripes = (rx: number, ry: number, rw: number, rh: number) => {
        const n = Math.max(3, Math.round((rw > rh ? rw : rh) / 12));
        for (let i = 0; i < n; i++) {
          g.fillStyle(i % 2 ? 0xffffff : col, 1);
          if (rw > rh) g.fillRect(rx + (rw * i) / n, ry, rw / n + 1, rh);
          else g.fillRect(rx, ry + (rh * i) / n, rw, rh / n + 1);
        }
      };
      const goods = (rx: number, ry: number, rw: number, rh: number) => {
        const cs = [shade(col, -0.2), 0xffd43b, 0xff8787, 0x69db7c];
        const n = Math.max(3, Math.round((rw > rh ? rw : rh) / 14));
        for (let i = 0; i < n; i++) {
          g.fillStyle(cs[i % cs.length], 1);
          if (rw > rh) g.fillRoundedRect(rx + 4 + i * ((rw - 8) / n), ry + 4, (rw - 8) / n - 3, rh - 8, 3);
          else g.fillRoundedRect(rx + 4, ry + 4 + i * ((rh - 8) / n), rw - 8, (rh - 8) / n - 3, 3);
        }
      };
      if (face === 'down') {
        stripes(x + 4, y + 4, w - 8, bk * 0.5);
        goods(x + 6, y + bk * 0.5 + 6, w - 12, bk);
        box(g, x + 6, y + h - ct - 4, w - 12, ct, shade(col, -0.1));
      } else if (face === 'up') {
        stripes(x + 4, y + h - bk * 0.5 - 4, w - 8, bk * 0.5);
        goods(x + 6, y + h - bk * 1.5 - 6, w - 12, bk);
        box(g, x + 6, y + 4, w - 12, ct, shade(col, -0.1));
      } else if (face === 'right') {
        stripes(x + 4, y + 4, bk * 0.5, h - 8);
        goods(x + bk * 0.5 + 6, y + 6, bk, h - 12);
        box(g, x + w - ct - 4, y + 6, ct, h - 12, shade(col, -0.1));
      } else {
        stripes(x + w - bk * 0.5 - 4, y + 4, bk * 0.5, h - 8);
        goods(x + w - bk * 1.5 - 6, y + 6, bk, h - 12);
        box(g, x + 4, y + 6, ct, h - 12, shade(col, -0.1));
      }
      return;
    }
    case 'escalator': {
      g.fillStyle(0x000000, 0.2).fillRoundedRect(x + 3, y + 5, w, h, 5);
      g.fillStyle(0xadb5bd, 1).fillRoundedRect(x, y, w, h, 5);
      g.fillStyle(0x495057, 1).fillRect(x + 5, y + 4, w - 10, h - 8);
      g.lineStyle(1.5, 0xced4da, 0.9);
      const n = Math.round((long ? w : h) / 7);
      for (let i = 1; i < n; i++) {
        if (long) g.lineBetween(x + 5 + ((w - 10) * i) / n, y + 4, x + 5 + ((w - 10) * i) / n, y + h - 4);
        else g.lineBetween(x + 5, y + 4 + ((h - 8) * i) / n, x + w - 5, y + 4 + ((h - 8) * i) / n);
      }
      g.fillStyle(0x212529, 1);
      if (long) g.fillRect(x, y, w, 3).fillRect(x, y + h - 3, w, 3);
      else g.fillRect(x, y, 3, h).fillRect(x + w - 3, y, 3, h);
      return;
    }
    case 'shelf': {
      // A supermarket shelf: a long unit, packets in colour on both faces.
      box(g, x, y, w, h, 0xdee2e6, long ? 0.3 : 0.08);
      const cs = [col, 0xff8787, 0xffd43b, 0x69db7c, 0x4dabf7, 0xffa94d];
      const n = Math.max(3, Math.round(((long ? w : h) / T) * 2.2));
      for (let i = 0; i < n; i++) {
        g.fillStyle(cs[i % cs.length], 1);
        const t = i / n;
        if (long) g.fillRect(x + 4 + t * (w - 8), y + 4, (w - 8) / n - 2, h * 0.5 - 4);
        else {
          g.fillRect(x + 3, y + 4 + t * (h - 8), w / 2 - 4, (h - 8) / n - 2);
          g.fillStyle(cs[(i + 2) % cs.length], 1).fillRect(x + w / 2 + 1, y + 4 + t * (h - 8), w / 2 - 4, (h - 8) / n - 2);
        }
      }
      return;
    }
    case 'aislesign':
      g.fillStyle(0x1864ab, 1).fillRoundedRect(x, y, w, h, 4);
      g.fillStyle(0xffffff, 0.9).fillRect(x + 3, y + 3, w - 6, 2);
      return;
    case 'freezer':
      box(g, x, y, w, h, 0xf8f9fa);
      g.fillStyle(0xa5d8ff, 0.9).fillRoundedRect(x + 4, y + 4, w - 8, h * 0.55, 3);
      g.lineStyle(1, 0xffffff, 0.8).lineBetween(x + 8, y + 7, x + w * 0.4, y + 7).lineBetween(x + w * 0.5, y + 10, x + w - 8, y + 10);
      return;
    case 'butcher':
    case 'fish':
    case 'bakery': {
      box(g, x, y, w, h, 0xe9ecef);
      g.fillStyle(0xd0ebff, 0.7).fillRoundedRect(x + 3, y + 3, w - 6, h - 10, 3);
      const cs = p.kind === 'butcher' ? [0xc92a2a, 0xe03131, 0xff8787] : p.kind === 'fish' ? [0xadb5bd, 0x74c0fc, 0xffa8a8] : [0xd9a066, 0xe8b77a, 0xb07a3c];
      const n = 5;
      for (let i = 0; i < n; i++) {
        g.fillStyle(cs[i % cs.length], 1);
        if (long) g.fillEllipse(x + 8 + ((w - 16) * i) / (n - 1), y + h * 0.4, 9, 6);
        else g.fillEllipse(x + w / 2, y + 8 + ((h - 22) * i) / (n - 1), 8, 9);
      }
      return;
    }
    case 'produce': {
      box(g, x, y, w, h, 0xa47148);
      const cs = [0xfab005, 0x40c057, 0xe03131, 0xfd7e14];
      for (let i = 0; i < 8; i++) g.fillStyle(cs[i % 4], 1).fillCircle(x + 6 + (i % 4) * ((w - 12) / 3), y + 6 + Math.floor(i / 4) * 7, 3.5);
      return;
    }
    case 'checkout':
      box(g, x, y, w, h, 0xadb5bd);
      g.fillStyle(0x212529, 1).fillRect(x + 4, y + 4, w * 0.6, h * 0.35);
      g.fillStyle(0x339af0, 1).fillRect(x + w * 0.72, y + 2, w * 0.18, h * 0.4);
      return;
    case 'divider':
      g.fillStyle(0x000000, 0.15).fillRect(x + 2, y + 3, w, h);
      g.fillStyle(col, 1).fillRect(x, y, w, h);
      g.fillStyle(shade(col, 0.3), 1).fillRect(x, y, long ? w : 2, long ? 2 : h);
      return;
    case 'sampletable':
      box(g, x, y, w, h, 0xffffff, 0.35);
      for (let i = 0; i < 4; i++) g.fillStyle(0xe8590c, 1).fillCircle(x + 6 + i * ((w - 12) / 3), cy - 2, 2.5);
      return;
    case 'bench':
    case 'plant':
    case 'fountain':
    case 'kiosk':
    case 'trolleys':
      drawFurniture(g, p.kind, cx, cy, accent);
      return;
  }
}

/** 🎈 A bunch of balloons (the balloon giver holds them; you get one). */
export function drawBalloons(g: Phaser.GameObjects.Graphics, cx: number, cy: number, n = 4) {
  const cs = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xda77f2];
  for (let i = 0; i < n; i++) {
    const bx = cx + (i - (n - 1) / 2) * 9, by = cy - 26 - (i % 2) * 7;
    g.lineStyle(1, 0x495057, 0.8).lineBetween(cx, cy, bx, by + 7);
    g.fillStyle(cs[i % cs.length], 1).fillEllipse(bx, by, 11, 14);
    g.fillStyle(0xffffff, 0.5).fillCircle(bx - 2, by - 3, 2);
  }
}
