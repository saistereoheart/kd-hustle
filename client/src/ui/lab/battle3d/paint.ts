// ⚔️ 3D fight: detail painted in 2D, wrapped onto the simple 3D shapes. That's where the "real"
// look comes from without extra shapes or lights: hair strands and a shine band, cloth folds and
// seams, fur, stone, scales, bandages, a painted face (irises, lashes, brows, blush), and soft
// shading (darker underneath = fake ambient occlusion). Each picture is small (64–256 px), made
// once per fight and shared, and freed with the rest when the fight ends.
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, w: number, h: number, paint: (x: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE.CanvasTexture {
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  paint(x, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  cache.set(key, t);
  return t;
}

const css = (c: THREE.Color) => `#${c.getHexString()}`;
const tone = (hex: string | number, l: number) => css(new THREE.Color(hex as THREE.ColorRepresentation).offsetHSL(0, 0, l));

/** Light on top, darker underneath: the fake ambient occlusion every texture gets. */
function shadeV(x: CanvasRenderingContext2D, w: number, h: number, top = 0.12, bottom = 0.45) {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(255,255,255,${top})`);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(0,0,0,${bottom})`);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
}

/** Hair: hundreds of thin strands in three tones, a shine band, darker roots underneath. */
export function hairTex(color: string) {
  return make(`hair|${color}`, 256, 256, (x, w, h) => {
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    const tones = [tone(color, -0.14), tone(color, -0.07), tone(color, 0.08), tone(color, 0.16)];
    for (let i = 0; i < 520; i++) {
      const sx = Math.random() * w, len = h * (0.3 + Math.random() * 0.7);
      x.strokeStyle = tones[i % tones.length];
      x.globalAlpha = 0.35 + Math.random() * 0.5;
      x.lineWidth = 0.8 + Math.random() * 1.6;
      x.beginPath();
      x.moveTo(sx, 0);
      x.bezierCurveTo(sx + (Math.random() - 0.5) * 18, len * 0.4, sx + (Math.random() - 0.5) * 24, len * 0.7, sx + (Math.random() - 0.5) * 30, len);
      x.stroke();
    }
    x.globalAlpha = 1;
    // The shine band (light from above catches the hair in a ring).
    const g = x.createLinearGradient(0, h * 0.18, 0, h * 0.4);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, h * 0.18, w, h * 0.22);
    shadeV(x, w, h, 0.05, 0.5);
  });
}

/** Cloth: a weave, fold lines, a seam, darker at the hem. */
export function clothTex(color: string, kind: 'top' | 'bottom' = 'top') {
  return make(`cloth|${kind}|${color}`, 128, 128, (x, w, h) => {
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    x.globalAlpha = 0.06;
    for (let y = 0; y < h; y += 2) (x.fillStyle = y % 4 ? '#000' : '#fff'), x.fillRect(0, y, w, 1);
    x.globalAlpha = 1;
    // Folds: soft dark creases with a light edge.
    for (let i = 0; i < 7; i++) {
      const fx = Math.random() * w;
      x.strokeStyle = 'rgba(0,0,0,0.18)';
      x.lineWidth = 3 + Math.random() * 4;
      x.beginPath();
      x.moveTo(fx, h * (kind === 'top' ? 0.35 : 0.1));
      x.quadraticCurveTo(fx + (Math.random() - 0.5) * 20, h * 0.65, fx + (Math.random() - 0.5) * 14, h);
      x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.1)';
      x.lineWidth = 1.5;
      x.stroke();
    }
    // A seam and, for a top, the collar's shadow under the chin.
    x.strokeStyle = tone(color, -0.2);
    x.setLineDash([3, 3]);
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(w / 2, 0);
    x.lineTo(w / 2, h);
    x.stroke();
    x.setLineDash([]);
    if (kind === 'top') {
      const g = x.createLinearGradient(0, 0, 0, h * 0.3);
      g.addColorStop(0, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h * 0.3);
    }
    shadeV(x, w, h, 0.08, 0.4);
  });
}

/** Skin: warm, a touch of variation, darker underneath. */
export function skinTex(color: string) {
  return make(`skin|${color}`, 64, 64, (x, w, h) => {
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,200,180' : '120,60,40'},0.05)`;
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 0, Math.PI * 2);
      x.fill();
    }
    shadeV(x, w, h, 0.1, 0.35);
  });
}

/** A painted face (on the front of the head): irises with a shine, lashes, brows, nose shade, mouth,
 *  blush. Wrapped on a sphere: u runs around (0.25 = the front, +z), v from top to bottom. */
export function faceTex(skin: string, eyes: string, hair: string) {
  return make(`face|${skin}|${eyes}|${hair}`, 256, 128, (x, w, h) => {
    x.fillStyle = skin;
    x.fillRect(0, 0, w, h);
    // Soft shading: cheeks rounder, temples darker.
    const g = x.createRadialGradient(w * 0.25, h * 0.55, 6, w * 0.25, h * 0.55, w * 0.32);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    const cx = w * 0.25; // the front of a three.js sphere's UVs (+z)
    const ey = h * 0.55;
    for (const s of [-1, 1]) {
      const ex = cx + s * 13;
      // Eye white, big iris with a gradient, pupil, two shines, upper lash line.
      x.fillStyle = '#fff';
      x.beginPath();
      x.ellipse(ex, ey, 7.5, 9, 0, 0, Math.PI * 2);
      x.fill();
      const ig = x.createRadialGradient(ex, ey + 2, 1, ex, ey + 1, 7);
      ig.addColorStop(0, tone(eyes, 0.25));
      ig.addColorStop(0.6, eyes);
      ig.addColorStop(1, tone(eyes, -0.2));
      x.fillStyle = ig;
      x.beginPath();
      x.ellipse(ex, ey + 1, 6, 7.5, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#111';
      x.beginPath();
      x.ellipse(ex, ey + 1.5, 3, 3.8, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#fff';
      x.beginPath();
      x.arc(ex + 2.2, ey - 2.5, 2, 0, Math.PI * 2);
      x.arc(ex - 2, ey + 3.5, 1, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#1b1210';
      x.lineWidth = 2.4;
      x.beginPath();
      x.ellipse(ex, ey + 1, 8, 9.5, 0, Math.PI * 1.08, Math.PI * 1.92);
      x.stroke();
      // Brows.
      x.strokeStyle = tone(hair, -0.1);
      x.lineWidth = 2.6;
      x.beginPath();
      x.moveTo(ex - 7, ey - 14 + (s > 0 ? 0 : 1));
      x.quadraticCurveTo(ex, ey - 17, ex + 7, ey - 14 + (s > 0 ? 1 : 0));
      x.stroke();
      // Blush.
      const bg = x.createRadialGradient(ex + s * 6, ey + 14, 1, ex + s * 6, ey + 14, 8);
      bg.addColorStop(0, 'rgba(255,110,110,0.45)');
      bg.addColorStop(1, 'rgba(255,110,110,0)');
      x.fillStyle = bg;
      x.fillRect(ex + s * 6 - 9, ey + 5, 18, 18);
    }
    // Nose shade and mouth.
    x.fillStyle = 'rgba(120,60,40,0.25)';
    x.beginPath();
    x.ellipse(cx, ey + 12, 2.2, 1.5, 0, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#7a2e2e';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(cx, ey + 15, 5, Math.PI * 0.15, Math.PI * 0.85);
    x.stroke();
  });
}

/** Fur: short strokes in the lay of the coat, lighter belly-ward, darker underneath. */
export function furTex(color: number) {
  const c = css(new THREE.Color(color));
  return make(`fur|${c}`, 128, 128, (x, w, h) => {
    x.fillStyle = c;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const px = Math.random() * w, py = Math.random() * h;
      x.strokeStyle = Math.random() < 0.5 ? tone(c, -0.12) : tone(c, 0.1);
      x.globalAlpha = 0.5;
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + (Math.random() - 0.5) * 3, py + 4 + Math.random() * 4);
      x.stroke();
    }
    x.globalAlpha = 1;
    shadeV(x, w, h, 0.12, 0.45);
  }, [2, 2]);
}

/** Stone / shell / crystal: blotches and cracks. */
export function stoneTex(color: number) {
  const c = css(new THREE.Color(color));
  return make(`stone|${c}`, 128, 128, (x, w, h) => {
    x.fillStyle = c;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      let px = Math.random() * w, py = Math.random() * h;
      x.beginPath();
      x.moveTo(px, py);
      for (let k = 0; k < 4; k++) x.lineTo((px += (Math.random() - 0.5) * 24), (py += Math.random() * 16));
      x.stroke();
    }
    shadeV(x, w, h, 0.1, 0.35);
  });
}

/** Scales: rows of overlapping arcs, each lit on top. */
export function scaleTex(color: number) {
  const c = css(new THREE.Color(color));
  return make(`scale|${c}`, 128, 128, (x, w, h) => {
    x.fillStyle = tone(c, -0.08);
    x.fillRect(0, 0, w, h);
    const s = 12;
    for (let row = 0, y = 0; y < h + s; y += s * 0.6, row++)
      for (let px = row % 2 ? s / 2 : 0; px < w + s; px += s) {
        const g = x.createLinearGradient(0, y - s / 2, 0, y + s / 2);
        g.addColorStop(0, tone(c, 0.12));
        g.addColorStop(1, tone(c, -0.12));
        x.fillStyle = g;
        x.beginPath();
        x.arc(px, y, s / 2, 0, Math.PI);
        x.fill();
      }
    shadeV(x, w, h, 0.08, 0.4);
  }, [2, 2]);
}

/** Bandages / a shroud: overlapping wraps with shadowed edges, a bit stained. */
export function wrapTex(color: number) {
  const c = css(new THREE.Color(color));
  return make(`wrap|${c}`, 128, 128, (x, w, h) => {
    x.fillStyle = c;
    x.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) {
      x.save();
      x.translate(0, y);
      x.rotate((Math.random() - 0.5) * 0.15);
      x.fillStyle = 'rgba(0,0,0,0.18)';
      x.fillRect(-10, 8, w + 20, 3);
      x.fillStyle = 'rgba(255,255,255,0.12)';
      x.fillRect(-10, 0, w + 20, 2);
      x.restore();
    }
    for (let i = 0; i < 10; i++) {
      x.fillStyle = 'rgba(120,90,40,0.12)';
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 10, 0, Math.PI * 2);
      x.fill();
    }
    shadeV(x, w, h, 0.08, 0.45);
  });
}

/** Just the soft top-light / under-shade, in a colour (for anything without its own pattern). */
export function softTex(color: number) {
  const c = css(new THREE.Color(color));
  return make(`soft|${c}`, 32, 64, (x, w, h) => {
    x.fillStyle = c;
    x.fillRect(0, 0, w, h);
    shadeV(x, w, h, 0.15, 0.45);
  });
}

/** A soft round shadow (dark middle, fading out), for under every fighter. */
export function shadowTex() {
  return make('shadow', 64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

export function disposePaint() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
