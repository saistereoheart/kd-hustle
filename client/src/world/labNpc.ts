// 🗝️ Labirin Purba's people, in pixel art like the dungeon's tileset (not the town's chibi look): the
// tavern keeper, Tok Peraih, and the adventurers round the campfire, on the benches and at the counter.
// Each look is painted once, pixel by pixel, into a tiny canvas (two breathing frames), outlined dark
// and shaded from the upper left, then shown scaled up with crisp (nearest) pixels. Cheap: one image
// each, a frame swap now and then.
import Phaser from 'phaser';
import { AVATAR_DEPTH } from './avatar';
import { LABEL_DEPTH } from './labRoomArt';

type Ramp = [string, string, string]; // dark, mid, light
type Pose = 'stand' | 'sit' | 'side' | 'back';

export interface NpcLook {
  skin: Ramp;
  hair?: { style: 'short' | 'long' | 'bald' | 'pony'; ramp: Ramp };
  top: Ramp;
  bottom: Ramp;
  boots: Ramp;
  /** A cape behind (and a hood up, framing the face). */
  cloak?: { ramp: Ramp; hood?: boolean };
  helm?: Ramp;
  /** A headscarf (tudung) that drapes over the shoulders. */
  scarf?: Ramp;
  beard?: Ramp;
  apron?: Ramp;
  /** A long robe to the feet instead of trousers. */
  robe?: boolean;
  belt?: string;
  item?: 'mug' | 'sword' | 'staffHand';
}

const SKIN: Record<string, Ramp> = {
  light: ['#9c6248', '#d39a76', '#f0c39f'],
  tan: ['#7c4a33', '#b47852', '#d9a07a'],
  brown: ['#4f2c1f', '#7e4a33', '#a76b4c'],
};

/** The looks used down here (by index; deeper rest chambers reuse them). */
export const NPC_LOOKS: NpcLook[] = [
  // 0 Mak Jah, the tavern keeper: maroon tudung, brown dress, cream apron, a mug of teh tarik.
  { skin: SKIN.tan, scarf: ['#4a1426', '#7a2639', '#a8445a'], top: ['#3d2618', '#6b4429', '#8c5d3b'], bottom: ['#3d2618', '#6b4429', '#8c5d3b'], boots: ['#1e1410', '#3a271b', '#523826'], apron: ['#8f8068', '#d9cba8', '#f2e6c9'], robe: true, item: 'mug' },
  // 1 a hooded ranger (green cloak, a sword over the shoulder).
  { skin: SKIN.light, hair: { style: 'short', ramp: ['#2b1a12', '#4a2e1d', '#6b4429'] }, cloak: { ramp: ['#14281c', '#24452f', '#386645'], hood: true }, top: ['#3b2a1c', '#5e4630', '#7d6043'], bottom: ['#2a2420', '#463b33', '#5e5047'], boots: ['#1a120d', '#33241a', '#4a3526'], belt: '#2a1a10', item: 'sword' },
  // 2 a knight: open steel helm, mail, a red cape.
  { skin: SKIN.brown, helm: ['#4a5160', '#8a93a6', '#c9d0dc'], cloak: { ramp: ['#4a0f14', '#7d1d24', '#a8333a'] }, top: ['#3d4250', '#6c7385', '#9aa2b4'], bottom: ['#2b2e38', '#474b59', '#646a7a'], boots: ['#16171c', '#2c2f38', '#444855'], belt: '#3a2614' },
  // 3 a traveller at the counter (seen from behind): brown cloak, black ponytail.
  { skin: SKIN.tan, hair: { style: 'pony', ramp: ['#0f0c10', '#231c24', '#3a2f3c'] }, cloak: { ramp: ['#2e1d12', '#4f3320', '#6e4b30'] }, top: ['#2e1d12', '#4f3320', '#6e4b30'], bottom: ['#22252e', '#3a3e4a', '#525766'], boots: ['#1a120d', '#33241a', '#4a3526'] },
  // 4 a young mage: long auburn hair, blue robe.
  { skin: SKIN.light, hair: { style: 'long', ramp: ['#5c1f12', '#8c3a1e', '#b85a2e'] }, top: ['#1c2350', '#2f3b82', '#4a5bb0'], bottom: ['#1c2350', '#2f3b82', '#4a5bb0'], boots: ['#1a120d', '#33241a', '#4a3526'], robe: true, belt: '#c9a227', item: 'mug' },
  // 5 a bald, bearded brawler: orange vest, leather bracers.
  { skin: SKIN.tan, hair: { style: 'bald', ramp: ['#7c4a33', '#b47852', '#d9a07a'] }, beard: ['#2b1a12', '#4a2e1d', '#6b4429'], top: ['#6b2e0c', '#a8501a', '#d47a2e'], bottom: ['#2a2420', '#463b33', '#5e5047'], boots: ['#1a120d', '#33241a', '#4a3526'], belt: '#2a1a10' },
  // 6.. rest-chamber campers (more of the same kinds, other colours).
  { skin: SKIN.brown, hair: { style: 'short', ramp: ['#0f0c10', '#231c24', '#3a2f3c'] }, cloak: { ramp: ['#2a1640', '#43255f', '#5f3a82'], hood: true }, top: ['#2e2a3a', '#4a445c', '#665e7e'], bottom: ['#22252e', '#3a3e4a', '#525766'], boots: ['#16171c', '#2c2f38', '#444855'], belt: '#2a1a10', item: 'sword' },
  { skin: SKIN.light, helm: ['#5c4a24', '#a8873e', '#dcc06a'], cloak: { ramp: ['#13304a', '#1f4f75', '#3271a0'] }, top: ['#4a3f2a', '#7d6b45', '#a8925f'], bottom: ['#2b2e38', '#474b59', '#646a7a'], boots: ['#16171c', '#2c2f38', '#444855'], belt: '#3a2614' },
  { skin: SKIN.tan, hair: { style: 'long', ramp: ['#141018', '#2a2230', '#40364a'] }, top: ['#18402e', '#2a6a4a', '#3f9468'], bottom: ['#18402e', '#2a6a4a', '#3f9468'], boots: ['#1a120d', '#33241a', '#4a3526'], robe: true, belt: '#8c6b2e' },
  { skin: SKIN.brown, hair: { style: 'short', ramp: ['#8a8a8a', '#c4c4c4', '#ececec'] }, beard: ['#8a8a8a', '#c4c4c4', '#ececec'], cloak: { ramp: ['#3a2a14', '#5e4520', '#80602e'] }, top: ['#3a2a14', '#5e4520', '#80602e'], bottom: ['#2a2420', '#463b33', '#5e5047'], boots: ['#1a120d', '#33241a', '#4a3526'], item: 'sword' },
];

/** Tok Peraih: an old sage in a deep purple robe, long white hair and beard; his hand on his staff. */
export const MERCHANT_LOOK: NpcLook = {
  skin: SKIN.light, hair: { style: 'long', ramp: ['#9aa0aa', '#d4d8de', '#f4f5f7'] }, beard: ['#9aa0aa', '#d4d8de', '#f4f5f7'],
  top: ['#22122f', '#3b2352', '#58367a'], bottom: ['#22122f', '#3b2352', '#58367a'], boots: ['#1e1410', '#2e1f14', '#45301f'], robe: true, belt: '#c9a227', item: 'staffHand',
};

const OUTLINE = '#120a16';
const EYE = '#160d1c';

/** Paints one look in one pose (frame 1: breathing in, the upper body a pixel lower). */
function paint(look: NpcLook, pose: Pose, frame: number): HTMLCanvasElement {
  const W = look.item === 'staffHand' ? 30 : 26, H = pose === 'stand' ? (look.item === 'staffHand' ? 37 : 36) : 30;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // 1 art pixel = 1 canvas pixel; x0 shifts the 26-wide layout into a wider canvas.
  const x0 = (W - 26) / 2 + 1, top = look.item === 'staffHand' ? 2 : 1;
  const px = (x: number, y: number, col: string, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x + x0), Math.round(y + top), w, h);
  };
  /** A shaded block: light left column and top row, dark right column and bottom row. */
  const block = (x: number, y: number, w: number, h: number, r: Ramp, opt: { topLit?: boolean } = {}) => {
    px(x, y, r[1], w, h);
    px(x, y, r[2], 1, h);
    if (opt.topLit !== false) px(x, y, r[2], w, 1);
    px(x + w - 1, y, r[0], 1, h);
    px(x, y + h - 1, r[0], w, 1);
  };
  const b = frame; // breathing bob for the upper body
  const side = pose === 'side', back = pose === 'back';
  // Where the waist is (everything above moves with the breath).
  const up = pose === 'stand' ? 0 : -6;

  // ---- Tok Peraih's staff (his hand grips it, drawn later), a gold cap and the orb on top
  if (look.item === 'staffHand') {
    px(24, 3, '#8d6e3f', 1, 31);
    px(25, 3, '#4a2f1a', 1, 31);
    px(23, 3, '#c9a227', 4, 1);
    px(23, 0, '#9ef0ff', 4, 3);
    px(24, -1, '#9ef0ff', 2, 5);
    px(24, 0, '#e3fafc', 2, 2);
  }

  // ---- legs / robe / seat
  if (pose === 'stand') {
    if (look.robe) {
      for (let y = 15; y <= 33; y++) {
        const k = Math.floor((y - 15) / 7);
        block(7 - k, y, 10 + k * 2, 1, look.top, { topLit: false });
      }
      px(6, 33, look.boots[1], 4, 1);
      px(14, 33, look.boots[1], 4, 1);
    } else {
      block(8, 25, 3, 6, look.bottom);
      block(13, 25, 3, 6, look.bottom);
      block(8, 25, 8, 2, look.bottom);
      block(7, 31, 4, 3, look.boots);
      block(13, 31, 4, 3, look.boots);
    }
  } else if (pose === 'sit') {
    block(7, 19, 10, 3, look.robe ? look.top : look.bottom);
    if (look.robe) block(6, 21, 12, 4, look.top, { topLit: false });
    else {
      block(8, 22, 3, 4, look.bottom);
      block(13, 22, 3, 4, look.bottom);
    }
    block(7, 25, 4, 3, look.boots);
    block(13, 25, 4, 3, look.boots);
  } else if (side) {
    // A log to sit on, then the legs: thigh forward, shin down, boot toe to the right.
    block(4, 24, 11, 3, ['#2a170c', '#4f3019', '#6e4626']);
    px(4, 24, '#7d5634', 1, 3);
    px(14, 24, '#24130a', 1, 3);
    block(10, 20, 8, 3, look.robe ? look.top : look.bottom);
    block(15, 22, 3, 4, look.robe ? look.top : look.bottom);
    block(15, 26, 5, 2, look.boots);
  } else {
    block(8, 23, 3, 3, look.bottom);
    block(13, 23, 3, 3, look.bottom);
    block(8, 26, 3, 2, look.boots);
    block(13, 26, 3, 2, look.boots);
  }

  const U = (y: number) => y + up + b; // upper-body rows

  // ---- cape behind
  if (look.cloak && !back) {
    if (side) block(6, U(13), 5, 12, look.cloak.ramp);
    else block(6, U(15), 12, pose === 'stand' ? 17 : 11, look.cloak.ramp);
  }

  // ---- torso and arms
  if (back) {
    const r = look.cloak?.ramp ?? look.top;
    for (let y = 15; y <= 22; y++) block(7 - (y > 19 ? 1 : 0), U(y), 10 + (y > 19 ? 2 : 0), 1, r, { topLit: false });
    px(6, U(15), r[1], 12, 1);
  } else if (side) {
    block(9, U(14), 6, 8, look.top);
    if (look.belt) px(9, U(20), look.belt, 6, 1);
    // The near arm, reaching out to the warmth.
    block(11, U(15), 2, 4, look.top);
    block(12, U(18), 4, 2, look.top);
    block(16, U(18), 2, 2, look.skin);
  } else {
    block(6, U(15), 12, 1, look.top);
    block(7, U(15), 10, 10, look.top);
    if (look.apron) {
      block(9, U(18), 6, 8, look.apron);
      px(9, U(16), look.apron[1], 1, 2);
      px(14, U(16), look.apron[1], 1, 2);
    }
    if (look.belt) px(7, U(23), look.belt, 10, 1);
    // A robe: a trimmed front opening down to the hem, wide sleeves.
    if (look.robe && look.belt && pose === 'stand') {
      for (let y = 16; y <= 33; y++) px(11, y > 23 ? y : U(y), y === 23 ? look.belt : look.top[0], 2, 1);
      px(11, 33, look.belt, 2, 1);
      px(5, U(21), look.top[2], 2, 1);
      px(17, U(21), look.top[0], 2, 1);
    }
    block(5, U(16), 2, 7, look.top);
    block(5, U(23), 2, 2, look.skin);
    if (look.item === 'staffHand') {
      // The right arm out to the staff he holds.
      block(17, U(15), 3, 3, look.top);
      block(20, U(14), 3, 2, look.top);
      block(23, U(13), 2, 3, look.skin);
    } else {
      block(17, U(16), 2, 7, look.top);
      block(17, U(23), 2, 2, look.skin);
    }
    if (look.item === 'mug') {
      block(18, U(21), 3, 4, ['#3a2214', '#6b4429', '#8c5d3b']);
      px(18, U(21), '#f2e6c9', 3, 1);
      px(21, U(22), '#3a2214', 1, 2);
    }
  }
  // A sword hilt over the shoulder.
  if (look.item === 'sword' && !back) {
    if (side) {
      px(7, U(10), '#c9a227', 3, 1);
      px(8, U(8), '#5a4a3a', 1, 2);
      px(8, U(11), '#8a93a6', 1, 3);
    } else {
      px(16, U(10), '#5a4a3a', 1, 2);
      px(15, U(12), '#c9a227', 3, 1);
      px(16, U(13), '#8a93a6', 1, 2);
    }
  }

  // ---- neck and head
  const hx = side ? 9 : 8;
  if (!back) px(side ? 11 : 11, U(14), look.skin[0], 2, 1);
  if (back) {
    const hr = look.hair?.ramp ?? look.skin;
    block(8, U(4), 8, 10, hr);
    for (const [cx, cy, w, h] of [[8, 4, 2, 1], [8, 5, 1, 1], [14, 4, 2, 1], [15, 5, 1, 1], [8, 13, 1, 1], [15, 13, 1, 1]]) g.clearRect(cx + x0, U(cy) + top, w, h);
    for (let x = 9; x < 15; x += 2) px(x, U(6), hr[0], 1, 6); // strands
    px(10, U(5), hr[2], 3, 1);
    if (look.hair?.style === 'pony') {
      px(11, U(12), '#7a2639', 2, 1); // the tie
      block(11, U(13), 2, 5, hr);
    }
  } else {
    // The face.
    block(hx, U(5), 8, 9, look.skin);
    g.clearRect(hx + x0, U(5) + top, 1, 2);
    g.clearRect(hx + 7 + x0, U(5) + top, 1, 2);
    g.clearRect(hx + 1 + x0, U(5) + top, 1, 1);
    g.clearRect(hx + 6 + x0, U(5) + top, 1, 1);
    g.clearRect(hx + x0, U(12) + top, 1, 2);
    g.clearRect(hx + 7 + x0, U(12) + top, 1, 2);
    g.clearRect(hx + 1 + x0, U(13) + top, 1, 1);
    g.clearRect(hx + 6 + x0, U(13) + top, 1, 1);
    if (side) {
      px(15, U(9), EYE);
      px(17, U(10), look.skin[1]); // nose
      px(16, U(12), look.skin[0]);
    } else {
      px(10, U(10), EYE);
      px(13, U(10), EYE);
      px(10, U(9), look.skin[0]);
      px(13, U(9), look.skin[0]);
      px(9, U(11), '#c96f6f');
      px(14, U(11), '#c96f6f');
      px(11, U(12), look.skin[0], 2, 1);
    }
    // Hair.
    const h = look.hair;
    if (h && h.style !== 'bald') {
      const r = h.ramp;
      if (side) {
        block(9, U(4), 7, 3, r);
        block(9, U(6), 3, h.style === 'long' ? 9 : 4, r);
        for (let x = 10; x < 16; x += 2) px(x, U(5), r[0], 1, 2);
        px(10, U(7), r[0], 1, h.style === 'long' ? 7 : 3);
      } else {
        block(8, U(3), 8, 4, r);
        px(9, U(2), r[1], 6, 1);
        px(8, U(7), r[1], 1, 2);
        px(15, U(7), r[0], 1, 2);
        px(9, U(7), r[1], 3, 1);
        px(14, U(7), r[1], 1, 1);
        // Strands: a few darker lines through it, a shine on top.
        for (let x = 9; x < 15; x += 2) px(x, U(4), r[0], 1, 2);
        px(10, U(3), r[2], 3, 1);
        if (h.style === 'long') {
          block(7, U(6), 2, 12, r);
          block(15, U(6), 2, 12, r);
          px(8, U(9), r[0], 1, 8);
          px(15, U(9), r[0], 1, 8);
          px(7, U(17), r[1], 1, 1);
          px(16, U(17), r[0], 1, 1);
        }
        if (h.style === 'pony') block(15, U(6), 2, 6, r);
      }
    } else if (h?.style === 'bald') px(side ? 11 : 10, U(5), look.skin[2], 2, 1); // a shiny scalp
    if (look.beard) {
      const r = look.beard;
      if (side) block(13, U(11), 4, 4, r);
      else {
        block(9, U(11), 6, 4, r);
        if (look.robe) block(10, U(15), 4, 3, r);
        px(10, U(12), look.skin[0], 4, 1); // the mouth through it
      }
    }
    if (look.helm) {
      const r = look.helm;
      if (side) block(9, U(3), 8, 4, r);
      else {
        block(8, U(3), 8, 4, r);
        px(8, U(7), r[1], 1, 4);
        px(15, U(7), r[0], 1, 4);
        px(11, U(7), r[2], 2, 2); // nose guard
      }
    }
    if (look.cloak?.hood) {
      const r = look.cloak.ramp;
      if (side) {
        block(8, U(3), 8, 3, r);
        block(8, U(5), 4, 9, r);
      } else {
        block(7, U(3), 10, 4, r);
        block(7, U(6), 2, 9, r);
        block(15, U(6), 2, 9, r);
        px(9, U(7), look.skin[0], 6, 1); // the hood's shadow on the brow
      }
    }
    if (look.scarf) {
      const r = look.scarf;
      block(7, U(3), 10, 4, r);
      block(7, U(6), 2, 9, r);
      block(15, U(6), 2, 9, r);
      for (let y = 14; y <= 17; y++) block(7 + (y - 14), U(y), 10 - (y - 14) * 2, 1, r, { topLit: false });
    }
  }

  // ---- light: warm firelight on the upper-left edges, shadow on the lower right, a little folds in
  // the cloth, and everything a touch darker and cooler (it's a dungeon)
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 0;
  const mix = (i: number, r: number, gg: number, bb: number, k: number) => {
    d[i] += (r - d[i]) * k;
    d[i + 1] += (gg - d[i + 1]) * k;
    d[i + 2] += (bb - d[i + 2]) * k;
  };
  const lit = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!lit[i + 3]) continue;
      const open = (dx: number, dy: number) => {
        const nx = x + dx, ny = y + dy;
        return nx < 0 || ny < 0 || nx >= W || ny >= H || !lit[(ny * W + nx) * 4 + 3];
      };
      d[i] *= 0.88;
      d[i + 1] *= 0.84;
      d[i + 2] *= 0.92;
      if (open(-1, 0)) mix(i, 255, 190, 120, 0.32);
      if (open(0, -1)) mix(i, 255, 215, 165, 0.22);
      if (open(1, 0)) mix(i, 10, 4, 18, 0.35);
      if (open(0, 1)) mix(i, 10, 4, 18, 0.25);
      // Folds: a soft darker line now and then down the lower body.
      if (y > H * 0.55 && (x * 7 + 3) % 5 === 0 && !open(-1, 0) && !open(1, 0) && (y + x) % 3 !== 0) mix(i, 10, 4, 18, 0.12);
    }

  // ---- the dark outline round it all (like the tileset's)
  const edge: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push(x, y);
  g.putImageData(img, 0, 0);
  g.fillStyle = OUTLINE;
  for (let i = 0; i < edge.length; i += 2) g.fillRect(edge[i], edge[i + 1], 1, 1);
  return c;
}

/** The texture key for a look + pose + frame (painted the first time it's asked for). */
function texture(scene: Phaser.Scene, id: string, look: NpcLook, pose: Pose, frame: number): string {
  const key = `labnpc:${id}:${pose}:${frame}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.addCanvas(key, paint(look, pose, frame));
    tex?.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  return key;
}

/** One of the Labirin's people. */
export class LabNpc {
  private container: Phaser.GameObjects.Container;
  private img: Phaser.GameObjects.Image;
  private keys: [string, string];
  private bubble: Phaser.GameObjects.Container | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  private phase = Math.random() * 1000;
  private frame = 0;
  private height: number;

  /** `px`: world pixels per art pixel; `flip`: face left (side poses face right). */
  constructor(private scene: Phaser.Scene, id: string, look: NpcLook, pose: Pose, x: number, y: number, px: number, flip = false) {
    this.keys = [texture(scene, id, look, pose, 0), texture(scene, id, look, pose, 1)];
    this.img = scene.add.image(0, 0, this.keys[0]).setOrigin(0.5, 1).setScale(px).setFlipX(flip);
    this.height = this.img.height * px;
    const shadow = scene.add.ellipse(0, -px, this.img.width * px * 0.7, px * 5, 0x000000, 0.35);
    this.container = scene.add.container(x, y, [shadow, this.img]).setDepth(AVATAR_DEPTH + y);
  }

  /** Breathing: swap the two frames now and then. */
  tick(now: number) {
    const f = Math.floor((now + this.phase) / 700) % 2;
    if (f === this.frame) return;
    this.frame = f;
    this.img.setTexture(this.keys[f]);
  }

  /** A parchment speech bubble above them (like yours down here). */
  say(text: string, ms: number) {
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    const label = this.scene.add
      .text(0, -5, text.length > 90 ? `${text.slice(0, 88)}…` : text.replace(/f(?=[ilf])/g, 'f‌'), {
        fontFamily: '"Pixelify Sans", system-ui, sans-serif', fontStyle: '500', fontSize: '13px', color: '#3b2414',
        wordWrap: { width: 150, useAdvancedWrap: true }, align: 'center', resolution: 3,
      })
      .setOrigin(0.5, 1);
    const w = label.width + 14, h = label.height + 10;
    const g = this.scene.add.graphics();
    g.fillStyle(0x5a3a1e, 1).fillTriangle(-7, -1, 7, -1, 0, 8);
    g.fillStyle(0xf3dfbd, 1).fillRoundedRect(-w / 2, -h, w, h, 7);
    g.fillStyle(0xf3dfbd, 1).fillTriangle(-5, -2, 5, -2, 0, 5);
    g.lineStyle(2, 0x5a3a1e, 1).strokeRoundedRect(-w / 2, -h, w, h, 7);
    g.fillStyle(0xffffff, 0.35).fillRect(-w / 2 + 4, -h + 3, w - 8, 2);
    this.bubble = this.scene.add.container(this.container.x, this.container.y - this.height - 8, [g, label]).setDepth(LABEL_DEPTH + 5);
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  destroy() {
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    this.container.destroy(true);
  }
}
