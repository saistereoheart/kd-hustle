// Character creator (§4). DOM panel + a live canvas preview that walks and rotates
// through the 4 directions. Everything is validated again on the server when saved.
import { randomAppearance, type Appearance, type CharacterConfig } from '@kh/shared';
import type { Pose, View } from '../character/draw';
import { poseForFrame, renderPreview } from '../character/sheet';
import { el, uiRoot } from './dom';
import { tabStrip } from './tabStrip';

type Opt = { id: string; name: string };

export interface CreatorOptions {
  title: string;
  saveLabel: string;
  onSave: (a: Appearance) => Promise<string | null>;
  onCancel?: () => void;
}

const DIRS: Array<{ view: View; flip: boolean }> = [
  { view: 'front', flip: false },
  { view: 'side', flip: true }, // facing right
  { view: 'back', flip: false },
  { view: 'side', flip: false }, // facing left
];

export function showCreator(cfg: CharacterConfig, initial: Appearance, opts: CreatorOptions) {
  let look: Appearance = { ...initial };
  let dirIdx = 0;
  let autoRotate = true;
  let frame = 0;
  let raf = 0;
  let lastStep = 0;
  let lastRotate = performance.now();

  const canvas = el('canvas', { class: 'creator-preview', width: '300', height: '380', 'data-testid': 'creator-preview' });
  const rotL = el('button', { class: 'round-btn', type: 'button', 'aria-label': 'Rotate left' }, '⟲');
  const rotR = el('button', { class: 'round-btn', type: 'button', 'aria-label': 'Rotate right' }, '⟳');
  const randomize = el('button', { class: 'btn', type: 'button', 'data-action': 'randomize' }, '🎲 Randomise');
  const error = el('div', { class: 'error' });
  const save = el('button', { class: 'btn primary', type: 'button', 'data-action': 'save' }, opts.saveLabel);
  const cancel = opts.onCancel ? el('button', { class: 'btn', type: 'button' }, 'Cancel') : null;
  const body = el('div', { class: 'cat-body' });
  const tabsBox = tabStrip('cat-tabs');

  // --- builders for option groups ------------------------------------------------
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => {
    look = { ...look, [k]: v };
    renderTab();
  };

  const chips = (title: string, options: Opt[], key: keyof Appearance) => {
    const box = el('div', { class: 'chips' });
    for (const o of options) {
      const b = el('button', { class: `chip${look[key] === o.id ? ' active' : ''}`, type: 'button', 'data-opt': `${key}:${o.id}` }, o.name);
      b.addEventListener('click', () => set(key, o.id as never));
      box.append(b);
    }
    return el('div', { class: 'opt-group' }, el('h4', {}, title), box);
  };

  const colors = (title: string, palette: string[], key: keyof Appearance, allowNone = false, noneLabel = 'None') => {
    const box = el('div', { class: 'swatches' });
    if (allowNone) {
      const b = el('button', { class: `swatch none${look[key] === null ? ' active' : ''}`, type: 'button', title: noneLabel, 'aria-label': noneLabel });
      b.addEventListener('click', () => set(key, null as never));
      box.append(b);
    }
    for (const c of palette) {
      const b = el('button', { class: `swatch${look[key] === c ? ' active' : ''}`, type: 'button', title: c, 'aria-label': c });
      b.style.background = c;
      b.addEventListener('click', () => set(key, c as never));
      box.append(b);
    }
    const current = look[key];
    const picker = el('input', { type: 'color', value: typeof current === 'string' ? current : palette[0], 'aria-label': `${title} custom colour` });
    picker.addEventListener('input', () => {
      look = { ...look, [key]: picker.value.toLowerCase() };
    });
    picker.addEventListener('change', () => set(key, picker.value.toLowerCase() as never));
    box.append(picker);
    return el('div', { class: 'opt-group' }, el('h4', {}, title), box);
  };

  const toggles = (title: string, items: Array<[keyof Appearance, string]>) => {
    const box = el('div', { class: 'chips' });
    for (const [key, name] of items) {
      const b = el('button', { class: `chip${look[key] ? ' active' : ''}`, type: 'button' }, name);
      b.addEventListener('click', () => set(key, !look[key] as never));
      box.append(b);
    }
    return el('div', { class: 'opt-group' }, el('h4', {}, title), box);
  };

  const P = cfg.palettes;
  const tabs: Array<{ id: string; name: string; build: () => HTMLElement[] }> = [
    {
      id: 'body', name: 'Body', build: () => [
        colors('Skin tone', cfg.skinTones, 'skin'),
        chips('Face shape', cfg.faceShapes, 'face'),
        chips('Height', cfg.heights, 'height'),
        chips('Build', cfg.builds, 'build'),
      ],
    },
    {
      id: 'face', name: 'Face', build: () => [
        chips('Eyes', cfg.eyes, 'eyes'),
        colors('Eye colour', P.eyes, 'eyeColor'),
        chips('Eyebrows', cfg.eyebrows, 'brows'),
        colors('Eyebrow colour', P.hair, 'browColor', true, 'Same as hair'),
        chips('Nose', cfg.noses, 'nose'),
        chips('Mouth', cfg.mouths, 'mouth'),
        toggles('Extras', [['blush', 'Blush'], ['freckles', 'Freckles'], ['beautyMark', 'Beauty mark']]),
        chips('Glasses', cfg.glasses, 'glasses'),
      ],
    },
    {
      id: 'hair', name: 'Hair', build: () => [
        chips('Hairstyle', cfg.hair, 'hair'),
        colors('Hair colour', P.hair, 'hairColor'),
        colors('Highlight', P.hair, 'highlight', true),
        chips('Facial hair', cfg.facialHair, 'facialHair'),
      ],
    },
    {
      id: 'head', name: 'Headwear', build: () => [
        chips('Tudung / hat', cfg.headwear, 'headwear'),
        colors('Headwear colour', P.clothes, 'headwearColor'),
      ],
    },
    {
      id: 'outfit', name: 'Outfit', build: () => [
        chips('Top', cfg.tops, 'top'),
        colors('Top colour', P.clothes, 'topColor'),
        chips('Bottom', cfg.bottoms, 'bottom'),
        colors('Bottom colour', P.clothes, 'bottomColor'),
        chips('Shoes', cfg.shoes, 'shoes'),
        colors('Shoe colour', P.clothes, 'shoesColor'),
      ],
    },
  ];
  let activeTab = tabs[0].id;

  function renderTab() {
    tabsBox.replaceChildren(
      ...tabs.map((t) => {
        const b = el('button', { type: 'button', class: t.id === activeTab ? 'active' : '', 'data-tab': t.id }, t.name);
        b.addEventListener('click', () => {
          activeTab = t.id;
          body.scrollTop = 0;
          renderTab();
        });
        return b;
      }),
    );
    const scroll = body.scrollTop;
    body.replaceChildren(...tabs.find((t) => t.id === activeTab)!.build());
    body.scrollTop = scroll;
  }

  // --- preview animation -----------------------------------------------------------
  const tick = (now: number) => {
    if (now - lastStep > 160) {
      frame = (frame + 1) % 4;
      lastStep = now;
    }
    if (autoRotate && now - lastRotate > 2200) {
      dirIdx = (dirIdx + 1) % 4;
      lastRotate = now;
    }
    const d = DIRS[dirIdx];
    const base = d.view === 'front' ? 0 : d.view === 'back' ? 6 : 12;
    const pose: Pose = poseForFrame(base + 2 + frame);
    renderPreview(canvas, look, cfg, pose, d.flip);
    raf = requestAnimationFrame(tick);
  };

  rotL.addEventListener('click', () => {
    autoRotate = false;
    dirIdx = (dirIdx + 3) % 4;
  });
  rotR.addEventListener('click', () => {
    autoRotate = false;
    dirIdx = (dirIdx + 1) % 4;
  });
  randomize.addEventListener('click', () => {
    look = randomAppearance(cfg);
    renderTab();
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    error.textContent = '';
    const err = await opts.onSave(look);
    save.disabled = false;
    if (err) error.textContent = err;
    else close();
  });
  cancel?.addEventListener('click', () => {
    close();
    opts.onCancel?.();
  });

  const root = el(
    'div',
    { class: 'creator', id: 'creator' },
    el(
      'div',
      { class: 'creator-top' },
      el('h2', { class: 'creator-title' }, opts.title),
      el('div', { class: 'creator-preview-wrap' }, rotL, canvas, rotR),
      el('div', { class: 'creator-actions' }, randomize),
    ),
    el(
      'div',
      { class: 'creator-bottom' },
      tabsBox,
      body,
      el('div', { class: 'creator-save' }, cancel, el('div', { style: 'flex:1;display:flex;flex-direction:column' }, error, save)),
    ),
  );

  function close() {
    cancelAnimationFrame(raf);
    root.remove();
  }

  renderTab();
  uiRoot().append(root);
  raf = requestAnimationFrame(tick);
  return { close };
}
