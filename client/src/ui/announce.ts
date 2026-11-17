// Server-wide rare-pull announcements: a banner for Legendary/Mythic, and a 5-second
// fireworks takeover for Divine/Secret.
import type { Announcement, RaritiesConfig } from '@kh/shared';
import { el, uiRoot } from './dom';
import { loadPrefs } from './settings';
import { sfx } from './sound';

let bannerBox: HTMLElement | null = null;

export function showAnnouncement(a: Announcement, rar: RaritiesConfig) {
  const tier = rar.tiers.find((t) => t.id === a.tier);
  const ti = rar.tiers.findIndex((t) => t.id === a.tier);
  if (!bannerBox || !bannerBox.isConnected) {
    bannerBox = el('div', { class: 'announce-box' });
    uiRoot().append(bannerBox);
  }
  const banner = el('div', { class: `announce tier-${a.tier}`, 'data-testid': 'announce' }, a.text);
  banner.style.setProperty('--tier', tier?.color ?? '#fcc419');
  bannerBox.append(banner);
  setTimeout(() => banner.classList.add('out'), 5500);
  setTimeout(() => banner.remove(), 6200);
  if (a.takeover) takeover(a, tier?.color ?? '#fff3bf', ti);
}

function takeover(a: Announcement, color: string, tierIndex: number) {
  const canvas = el('canvas', {});
  const host = el('div', { class: 'takeover' }, canvas, el('div', { class: 'takeover-text' }, el('div', { class: 'takeover-tier' }, a.tier.toUpperCase()), el('div', {}, a.text.replace(/^🔥 /, ''))));
  host.style.setProperty('--tier', color);
  uiRoot().append(host);
  sfx.reveal(tierIndex);
  const W = (canvas.width = innerWidth);
  const H = (canvas.height = innerHeight);
  const ctx = canvas.getContext('2d')!;
  const sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; c: string }> = [];
  const colors = [color, '#ffffff', '#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#da77f2'];
  const lite = !loadPrefs().particles;
  const boom = () => {
    const x = W * (0.15 + Math.random() * 0.7);
    const y = H * (0.15 + Math.random() * 0.45);
    const c = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < (lite ? 25 : 70); i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, c });
    }
  };
  const start = performance.now();
  let nextBoom = 0;
  const frame = (now: number) => {
    const t = now - start;
    if (t > nextBoom && t < 4200) {
      boom();
      nextBoom = t + 380;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
    for (const s of sparks) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.06;
      s.life -= 0.012;
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, s.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    if (t < 5000) requestAnimationFrame(frame);
    else host.remove();
  };
  requestAnimationFrame(frame);
  host.addEventListener('click', () => host.remove());
}
