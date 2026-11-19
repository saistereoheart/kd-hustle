// 🐞 Report a bug / suggestion / feedback. The big button on the HUD opens this: pick what
// kind of note it is, write it, send. The server stores it with where you were and your level;
// the client adds your district, screen size, device and the last few script errors so the host
// can reproduce bugs. Admins (the host) also get an 📥 Inbox tab to read and tick off reports
// (or run `npm run admin -- feedback` on the server PC).
import { FEEDBACK_MAX_CHARS, FEEDBACK_MAX_IMAGE, FEEDBACK_MIN_CHARS, type FeedbackKind, type FeedbackReport } from '@kh/shared';
import type { App } from '../app';
import { el, toast } from './dom';
import { openPanel, tabs } from './panel';

const KINDS: Array<{ id: FeedbackKind; icon: string; name: string; hint: string }> = [
  { id: 'bug', icon: '🐞', name: 'Bug', hint: 'What happened? What did you expect? What were you doing just before?' },
  { id: 'idea', icon: '💡', name: 'Suggestion', hint: 'What would make the game better? A feature, item, place or change…' },
  { id: 'feedback', icon: '💬', name: 'Feedback', hint: 'Too hard, too easy, confusing, fun? Tell us anything.' },
];
const KIND_ICON: Record<string, string> = { bug: '🐞', idea: '💡', feedback: '💬' };

// --- the last few script errors (sent with bug reports) --------------------------------------
const recentErrors: string[] = [];
function noteError(msg: string) {
  const line = msg.replace(/\s+/g, ' ').slice(0, 380);
  if (!line || recentErrors[recentErrors.length - 1] === line) return;
  recentErrors.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (recentErrors.length > 5) recentErrors.shift();
}
window.addEventListener('error', (e) => noteError(`${e.message} @ ${(e.filename ?? '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => noteError(`Unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));

/** What you were writing if you closed the window before sending (kept until it's sent). */
let draft = { kind: 'bug' as FeedbackKind, text: '', image: null as string | null };

/** Shrinks a picture to a JPEG data URL small enough to send (≤ ~600 KB). */
async function shrinkImage(src: CanvasImageSource & { width: number; height: number }): Promise<string> {
  for (const [max, q] of [[1400, 0.8], [1100, 0.7], [800, 0.6]] as const) {
    const k = Math.min(1, max / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length <= FEEDBACK_MAX_IMAGE * 0.7) return url;
  }
  throw new Error('That picture is too big.');
}

function fileToImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), resolve(img));
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('Not a picture.')));
    img.src = url;
  });
}

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function contextLine(r: FeedbackReport) {
  const c = r.context as { scene?: string; interior?: string; tile?: { x: number; y: number }; district?: string; level?: number; screen?: string };
  return [c.district, c.interior ? `inside ${c.interior}` : c.scene && c.scene !== 'town' ? c.scene : '', c.tile ? `tile ${c.tile.x},${c.tile.y}` : '', c.level ? `Lv ${c.level}` : '', c.screen]
    .filter(Boolean)
    .join(' · ');
}

function reportText(r: FeedbackReport) {
  const c = r.context as { device?: string; errors?: string[] };
  return [
    `#${r.id} ${KIND_ICON[r.kind] ?? ''} ${r.kind} from ${r.username} (${new Date(r.at).toLocaleString()})`,
    contextLine(r),
    c.device ?? '',
    r.text,
    ...(c.errors ?? []).map((e) => `error: ${e}`),
  ]
    .filter(Boolean)
    .join('\n');
}

export function openFeedback(app: App, opts: { district?: string; inbox?: boolean } = {}) {
  const panel = openPanel('🐞 Report a bug / idea', { testId: 'feedback-panel', cls: 'feedback-panel' });
  const sendPane = el('div', {});
  const inboxPane = el('div', { class: 'hidden' });
  if (app.store.isAdmin) {
    const bar = tabs(['✍️ Write', '📥 Inbox'], (i) => {
      sendPane.classList.toggle('hidden', i !== 0);
      inboxPane.classList.toggle('hidden', i !== 1);
      if (i === 1) loadInbox();
    }, opts.inbox ? 1 : 0);
    panel.body.append(bar);
    if (opts.inbox) {
      sendPane.classList.add('hidden');
      inboxPane.classList.remove('hidden');
    }
  }
  panel.body.append(sendPane, inboxPane);

  // --- write -------------------------------------------------------------------------------
  const text = el('textarea', { class: 'feedback-text', maxlength: String(FEEDBACK_MAX_CHARS), rows: '6', 'data-testid': 'feedback-text' }) as HTMLTextAreaElement;
  text.value = draft.text;
  const count = el('span', { class: 'muted small' });
  const send = el('button', { class: 'btn primary feedback-send', type: 'button', 'data-action': 'feedback-send' }, 'Send report') as HTMLButtonElement;
  const chips = el('div', { class: 'chips feedback-kinds' });
  const paint = () => {
    const k = KINDS.find((x) => x.id === draft.kind)!;
    chips.replaceChildren(
      ...KINDS.map((x) => {
        const b = el('button', { type: 'button', class: `chip${x.id === draft.kind ? ' active' : ''}`, 'data-kind': x.id }, `${x.icon} ${x.name}`);
        b.addEventListener('click', () => {
          draft.kind = x.id;
          paint();
        });
        return b;
      }),
    );
    text.placeholder = k.hint;
    const n = text.value.trim().length;
    count.textContent = `${text.value.length} / ${FEEDBACK_MAX_CHARS}`;
    send.disabled = n < FEEDBACK_MIN_CHARS;
    send.textContent = `${k.icon} Send ${k.name.toLowerCase()}`;
  };
  text.addEventListener('input', () => {
    draft.text = text.value;
    paint();
  });

  // A picture: pick a file, paste one (Ctrl+V), or snap the game screen.
  const picBox = el('div', { class: 'feedback-pic' });
  const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden', 'data-testid': 'feedback-file' }) as HTMLInputElement;
  const setPic = async (get: () => Promise<CanvasImageSource & { width: number; height: number }>) => {
    try {
      draft.image = await shrinkImage(await get());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not use that picture.', 'bad');
    }
    paintPic();
  };
  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    if (f) void setPic(() => fileToImage(f));
    fileIn.value = '';
  });
  text.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (!f) return;
    e.preventDefault();
    void setPic(() => fileToImage(f));
  });
  const pick = el('button', { class: 'btn small', type: 'button', 'data-action': 'feedback-pick' }, '🖼️ Add a picture');
  pick.addEventListener('click', () => fileIn.click());
  const snap = el('button', { class: 'btn small', type: 'button', 'data-action': 'feedback-snap', title: 'A picture of the game screen (without this window)' }, '📸 Snap the game');
  snap.addEventListener('click', () => {
    const r = app.game?.renderer as unknown as { snapshot?: (cb: (img: HTMLImageElement | unknown) => void) => void } | undefined;
    if (!r?.snapshot) return toast('Can\'t take a picture here.', 'bad');
    r.snapshot((img) => {
      if (img instanceof HTMLImageElement) {
        const ready = img.complete ? Promise.resolve(img) : new Promise<HTMLImageElement>((res) => (img.onload = () => res(img)));
        void setPic(() => ready);
      } else toast('Can\'t take a picture here.', 'bad');
    });
  });
  const paintPic = () => {
    if (!draft.image) {
      picBox.replaceChildren(pick, snap, el('span', { class: 'muted small' }, 'or paste one (Ctrl+V) into the box'), fileIn);
      return;
    }
    const remove = el('button', { class: 'btn small', type: 'button', 'data-action': 'feedback-unpick' }, '✕ Remove');
    remove.addEventListener('click', () => {
      draft.image = null;
      paintPic();
    });
    picBox.replaceChildren(el('img', { class: 'feedback-thumb', src: draft.image, alt: 'Attached picture' }), remove, fileIn);
  };
  paintPic();
  send.addEventListener('click', () => {
    if (!app.socket) return toast('Not connected right now. Try again in a moment.', 'bad');
    send.disabled = true;
    send.textContent = 'Sending…';
    const client = {
      district: opts.district?.replace(/^📍\s*/, '') || undefined,
      screen: `${innerWidth}×${innerHeight} @${devicePixelRatio.toFixed(2)}x`,
      device: navigator.userAgent.slice(0, 300),
      errors: draft.kind === 'bug' && recentErrors.length ? [...recentErrors] : undefined,
    };
    app.socket.timeout(15000).emit('feedback:send', { kind: draft.kind, text: text.value, client, ...(draft.image ? { image: draft.image } : {}) }, (err, res) => {
      if (err || !res.ok) {
        toast(err ? 'No reply from the server. Your note is kept; try again.' : res.ok ? '' : res.error, 'bad');
        return paint();
      }
      draft = { kind: draft.kind, text: '', image: null };
      toast(`Thanks! Report #${res.id} sent to the host 🙏`, 'good', 3200);
      panel.close();
    });
  });
  sendPane.append(
    el('p', { class: 'muted' }, 'Found something broken, or have an idea? Tell the host. Every report is read.'),
    chips,
    text,
    picBox,
    el('div', { class: 'feedback-foot' }, count, el('span', { class: 'muted small' }, '📎 Your spot, level, screen size and device are attached automatically.')),
    send,
  );
  paint();
  setTimeout(() => text.focus(), 50);

  // --- inbox (admins) ------------------------------------------------------------------------
  let showDone = false;
  let reports: FeedbackReport[] | null = null;
  function loadInbox() {
    inboxPane.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    app.socket?.timeout(6000).emit('feedback:list', (err, res) => {
      if (err || !res.ok) {
        inboxPane.replaceChildren(el('p', { class: 'muted' }, err ? 'No reply from the server.' : res.ok ? '' : res.error));
        return;
      }
      reports = res.reports;
      app.hud?.setFeedbackBadge(res.open);
      renderInbox();
    });
  }
  function renderInbox() {
    if (!reports) return;
    const list = reports.filter((r) => showDone || !r.done);
    const open = reports.filter((r) => !r.done).length;
    const toggle = el('button', { type: 'button', class: 'btn small' }, showDone ? 'Hide done' : `Show done (${reports.length - open})`);
    toggle.addEventListener('click', () => {
      showDone = !showDone;
      renderInbox();
    });
    const copy = el('button', { type: 'button', class: 'btn small' }, '📋 Copy all shown');
    copy.addEventListener('click', () => {
      const txt = list.map(reportText).join('\n\n---\n\n');
      navigator.clipboard?.writeText(txt).then(
        () => toast(`Copied ${list.length} report${list.length === 1 ? '' : 's'}`, 'good'),
        () => toast('Copy failed (the browser blocked it). On the server PC run: npm run admin -- feedback', 'bad', 4500),
      ) ?? toast('Copy needs https or localhost. On the server PC run: npm run admin -- feedback', 'bad', 4500);
    });
    inboxPane.replaceChildren(
      el('div', { class: 'feedback-inbox-head' }, el('b', {}, `${open} open`), toggle, copy),
      ...(list.length ? list.map(card) : [el('p', { class: 'muted' }, showDone ? 'No reports yet.' : 'All caught up ✨')]),
    );
  }
  function card(r: FeedbackReport) {
    const c = r.context as { device?: string; errors?: string[] };
    const done = el('button', { type: 'button', class: 'btn small' }, r.done ? '↩ Reopen' : '✓ Done');
    done.addEventListener('click', () => {
      app.socket?.timeout(6000).emit('feedback:done', { id: r.id, done: !r.done }, (err, res) => {
        if (err || !res.ok) return toast(err ? 'No reply' : res.ok ? '' : res.error, 'bad');
        r.done = !r.done;
        app.hud?.setFeedbackBadge(reports!.filter((x) => !x.done).length);
        renderInbox();
      });
    });
    return el(
      'div',
      { class: `feedback-card kind-${r.kind}${r.done ? ' done' : ''}` },
      el('div', { class: 'feedback-card-head' }, el('b', {}, `${KIND_ICON[r.kind] ?? '💬'} ${r.username}`), el('span', { class: 'muted small' }, `#${r.id} · ${ago(r.at)}`), done),
      el('div', { class: 'feedback-card-text' }, r.text),
      el('div', { class: 'muted small' }, contextLine(r)),
      ...(c.errors?.length ? [el('details', { class: 'small' }, el('summary', {}, `⚠ ${c.errors.length} script error${c.errors.length === 1 ? '' : 's'}`), ...c.errors.map((e) => el('div', { class: 'feedback-err' }, e)))] : []),
      ...(c.device ? [el('div', { class: 'muted small feedback-device' }, c.device)] : []),
      ...(r.context.image ? [picButton(r.id)] : []),
    );
  }
  /** The report's picture: loaded when you tap (they can be a few hundred KB each). */
  function picButton(id: number) {
    const b = el('button', { class: 'btn small', type: 'button', 'data-action': 'feedback-show-pic' }, '🖼️ Show picture');
    b.addEventListener('click', () => {
      b.disabled = true;
      app.socket?.timeout(10000).emit('feedback:image', { id }, (err, res) => {
        if (err || !res.ok) {
          b.disabled = false;
          return toast(err ? 'No reply' : res.ok ? '' : res.error, 'bad');
        }
        const img = el('img', { class: 'feedback-pic-full', src: res.dataUrl, alt: `Report #${id}` });
        img.addEventListener('click', () => window.open()?.document.write(`<img src="${res.dataUrl}" style="max-width:100%">`));
        b.replaceWith(img);
      });
    });
    return b;
  }
  if (opts.inbox) loadInbox();
}
