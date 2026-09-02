// The dayGLANCE sidebar view (companion spec 4.2): a mini month calendar
// over the agenda for the selected day, read from the AgendaStore's mirror.
// Read-only with one exception — checking a task's box emits a completion
// action for dayGLANCE to apply (agenda.ts). Rescheduling, drag-to-move and
// creation are out of scope for v1 by ruling.
//
// Rendering is a plain re-render on every store change or navigation (the
// agenda is a few dozen rows at most); the styles are injected once from
// here (no styles.css to ship) and lean entirely on Obsidian's theme
// variables so the view follows the user's theme.

import { ItemView, Keymap, Notice, WorkspaceLeaf } from 'obsidian';
import { datesWithItems, localDateStr, shiftDateStr, splitTitle, weekdayOrder, type AgendaItem, type RoutineItem } from '@glance-apps/agenda-core';
import type { AgendaStore } from './agenda';

export const AGENDA_VIEW_TYPE = 'dayglance-agenda';
// The projection window: ±35 days around today covers the visible month
// grid from any neighbouring month plus the agenda's reachable days.
export const AGENDA_WINDOW_DAYS = 35;

const STYLE_ID = 'dayglance-agenda-style';
const CSS = `
.dg-agenda { padding: 4px 8px 12px; font-size: var(--font-ui-small); }
.dg-agenda-month { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 6px; }
.dg-agenda-month-title { font-weight: 600; font-size: var(--font-ui-medium); }
.dg-agenda-month-nav { display: flex; gap: 2px; }
.dg-agenda-month-nav button { padding: 0 8px; height: 24px; line-height: 24px; }
.dg-agenda-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 8px; }
.dg-agenda-dow { text-align: center; color: var(--text-faint); font-size: var(--font-ui-smaller); padding-bottom: 2px; }
.dg-agenda-day { position: relative; text-align: center; border-radius: var(--radius-s); padding: 3px 0 7px; cursor: pointer; color: var(--text-normal); }
.dg-agenda-day:hover { background: var(--background-modifier-hover); }
.dg-agenda-day.is-outside { color: var(--text-faint); }
.dg-agenda-day.is-today { font-weight: 700; color: var(--interactive-accent); }
.dg-agenda-day.is-selected { background: var(--interactive-accent); color: var(--text-on-accent); }
.dg-agenda-day.has-items::after { content: ''; position: absolute; left: 50%; bottom: 2px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: currentColor; opacity: 0.8; }
.dg-agenda-heading { display: flex; align-items: baseline; justify-content: space-between; border-top: 1px solid var(--background-modifier-border); padding-top: 8px; margin-bottom: 4px; }
.dg-agenda-heading-date { font-weight: 600; }
.dg-agenda-heading-count { color: var(--text-muted); font-size: var(--font-ui-smaller); }
.dg-agenda-list { list-style: none; margin: 0; padding: 0; }
.dg-agenda-item { display: flex; align-items: flex-start; gap: 8px; padding: 4px 2px; border-radius: var(--radius-s); }
.dg-agenda-item:hover { background: var(--background-modifier-hover); }
.dg-agenda-item input[type=checkbox] { margin-top: 2px; flex: 0 0 auto; }
.dg-agenda-item.is-done .dg-agenda-title { text-decoration: line-through; color: var(--text-muted); }
.dg-agenda-item.is-pending .dg-agenda-title { color: var(--text-muted); font-style: italic; }
.dg-agenda-body { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.dg-agenda-time { color: var(--text-muted); font-size: var(--font-ui-smaller); font-variant-numeric: tabular-nums; }
.dg-agenda-title { overflow-wrap: anywhere; }
.dg-agenda-badge { color: var(--text-faint); font-size: var(--font-ui-smaller); margin-left: 4px; }
.dg-agenda-tag { color: var(--text-faint); font-style: italic; }
.dg-agenda-link { color: var(--link-color); text-decoration: none; cursor: pointer; }
.dg-agenda-link:hover { text-decoration: underline; }
.dg-agenda-routines-heading { color: var(--text-faint); font-size: var(--font-ui-smaller); text-transform: uppercase; letter-spacing: 0.06em; margin: 12px 2px 4px; }
.dg-agenda-routines { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0; padding: 0; list-style: none; }
.dg-agenda-routine { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 8px; border-radius: 999px; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); color: var(--text-muted); font-size: var(--font-ui-smaller); max-width: 100%; }
.dg-agenda-routine-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); flex: 0 0 auto; opacity: 0.7; }
.dg-agenda-routine-time { font-variant-numeric: tabular-nums; color: var(--text-faint); }
.dg-agenda-routine-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dg-agenda-routine.is-done { opacity: 0.55; }
.dg-agenda-routine.is-done .dg-agenda-routine-name { text-decoration: line-through; }
.dg-agenda-swatch { flex: 0 0 4px; width: 4px; align-self: stretch; border-radius: 2px; }
.dg-agenda-empty { color: var(--text-muted); padding: 8px 2px; }
.dg-agenda-status { color: var(--text-faint); font-size: var(--font-ui-smaller); margin-top: 10px; padding-top: 6px; border-top: 1px solid var(--background-modifier-border); }
.dg-agenda-status.is-error { color: var(--text-error); }
.dg-agenda-setup { color: var(--text-muted); padding: 8px 2px; }
`;

export function injectAgendaStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export function removeAgendaStyles(doc: Document): void {
  doc.getElementById(STYLE_ID)?.remove();
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const DOW_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const noonOf = (dateStr: string): Date => new Date(`${dateStr}T12:00:00`);

const formatTime = (hhmm: string): string => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  return TIME_FMT.format(d);
};

const endOf = (hhmm: string, duration: number): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || !(duration > 0)) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + duration;
  if (total >= 24 * 60) return null;
  return formatTime(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
};

// dayGLANCE colors are Tailwind utility classes (colorUtils.js TASK_COLORS,
// feed defaults like bg-gray-600); imported native events carry a real CSS
// color. Map the classes to the palette's hex so the swatch renders; pass
// real colors through; anything else gets no swatch.
const TAILWIND: Record<string, string> = {
  blue: '#3b82f6', purple: '#a855f7', green: '#22c55e', orange: '#f97316', pink: '#ec4899',
  indigo: '#6366f1', red: '#ef4444', teal: '#14b8a6', yellow: '#eab308', gray: '#4b5563',
  cyan: '#06b6d4', emerald: '#10b981', lime: '#84cc16', amber: '#f59e0b', rose: '#f43f5e',
  violet: '#8b5cf6', fuchsia: '#d946ef', sky: '#0ea5e9', slate: '#64748b', stone: '#78716c',
};
const swatchColor = (color: string | null): string | null => {
  if (!color) return null;
  const m = /^bg-([a-z]+)-\d{3}$/.exec(color);
  if (m) return TAILWIND[m[1]] ?? null;
  if (color === 'task-calendar') return null;
  return /^(#|rgb|hsl|[a-z]+$)/i.test(color) ? color : null;
};

const relativeAge = (ms: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
};

export class AgendaView extends ItemView {
  private store: AgendaStore;
  private weekStartDay: number;
  private selected: string;
  private month: { y: number; m: number }; // m is 0-based
  private unsubscribe: (() => void) | null = null;
  private root: HTMLElement | null = null;
  // The view's own midnight guard: `today` moves without any store change.
  private clock: number | null = null;
  private renderedFor = '';

  constructor(leaf: WorkspaceLeaf, store: AgendaStore, weekStartDay = 0) {
    super(leaf);
    this.store = store;
    this.weekStartDay = weekStartDay;
    const today = localDateStr(new Date());
    this.selected = today;
    const d = noonOf(today);
    this.month = { y: d.getFullYear(), m: d.getMonth() };
  }

  getViewType(): string { return AGENDA_VIEW_TYPE; }
  getDisplayText(): string { return 'dayGLANCE'; }
  getIcon(): string { return 'calendar-check'; }

  async onOpen(): Promise<void> {
    injectAgendaStyles(this.containerEl.ownerDocument);
    const content = this.containerEl.children[1] as HTMLElement;
    content.empty();
    this.root = content.createDiv({ cls: 'dg-agenda' });
    this.unsubscribe = this.store.onChange(() => this.render());
    this.clock = window.setInterval(() => {
      const today = localDateStr(new Date());
      if (today !== this.renderedFor) this.render();
    }, 60_000);
    this.render();
    void this.store.refresh();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.clock !== null) window.clearInterval(this.clock);
    this.clock = null;
  }

  /** Jump the grid and the agenda to a date (the ribbon/command land on today). */
  showDate(dateStr: string): void {
    this.selected = dateStr;
    const d = noonOf(dateStr);
    this.month = { y: d.getFullYear(), m: d.getMonth() };
    this.render();
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    root.empty();
    const today = localDateStr(new Date());
    this.renderedFor = today;
    const status = this.store.getStatus();

    if (status.key !== 'ready') {
      root.createDiv({ cls: 'dg-agenda-setup', text: status.key === 'unpaired'
        ? 'Pair this vault with dayGLANCE to see your agenda here (Settings, dayGLANCE Bridge).'
        : 'Enter your dayGLANCE sync passphrase in Settings, dayGLANCE Bridge, dayGLANCE account, to load your agenda on this device.' });
      return;
    }

    const from = shiftDateStr(today, -AGENDA_WINDOW_DAYS);
    const to = shiftDateStr(today, AGENDA_WINDOW_DAYS);
    const agenda = this.store.agenda(from, to);
    const dotted = datesWithItems(agenda);

    this.renderMonth(root, today, dotted, from, to);
    this.renderDay(root, today, agenda[this.selected] ?? [], from, to);
    this.renderStatus(root, status);
  }

  private renderMonth(root: HTMLElement, today: string, dotted: Set<string>, from: string, to: string): void {
    const head = root.createDiv({ cls: 'dg-agenda-month' });
    head.createSpan({ cls: 'dg-agenda-month-title', text: MONTH_FMT.format(new Date(this.month.y, this.month.m, 1, 12)) });
    const nav = head.createDiv({ cls: 'dg-agenda-month-nav' });
    const prev = nav.createEl('button', { text: '‹', attr: { 'aria-label': 'Previous month' } });
    const todayBtn = nav.createEl('button', { text: 'Today', attr: { 'aria-label': 'Go to today' } });
    const next = nav.createEl('button', { text: '›', attr: { 'aria-label': 'Next month' } });
    prev.addEventListener('click', () => this.shiftMonth(-1));
    next.addEventListener('click', () => this.shiftMonth(1));
    todayBtn.addEventListener('click', () => this.showDate(today));

    const grid = root.createDiv({ cls: 'dg-agenda-grid' });
    const order = weekdayOrder(this.weekStartDay);
    for (const dow of order) {
      // 2023-01-01 was a Sunday; +dow lands on the right weekday for a label.
      grid.createDiv({ cls: 'dg-agenda-dow', text: DOW_FMT.format(new Date(2023, 0, 1 + dow, 12)) });
    }
    const first = new Date(this.month.y, this.month.m, 1, 12);
    const lead = (first.getDay() - this.weekStartDay + 7) % 7;
    const daysInMonth = new Date(this.month.y, this.month.m + 1, 0, 12).getDate();
    const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
    const start = new Date(first);
    start.setDate(first.getDate() - lead);
    for (let i = 0; i < cells; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const ds = localDateStr(d);
      const cell = grid.createDiv({ cls: 'dg-agenda-day', text: String(d.getDate()) });
      if (d.getMonth() !== this.month.m) cell.addClass('is-outside');
      if (ds === today) cell.addClass('is-today');
      if (ds === this.selected) cell.addClass('is-selected');
      if (dotted.has(ds)) cell.addClass('has-items');
      if (ds < from || ds > to) cell.setAttr('title', 'Outside the loaded window');
      cell.addEventListener('click', () => { this.selected = ds; this.render(); });
    }
  }

  private shiftMonth(delta: number): void {
    const d = new Date(this.month.y, this.month.m + delta, 1, 12);
    this.month = { y: d.getFullYear(), m: d.getMonth() };
    this.render();
  }

  private renderDay(root: HTMLElement, today: string, items: AgendaItem[], from: string, to: string): void {
    const head = root.createDiv({ cls: 'dg-agenda-heading' });
    const label = this.selected === today ? 'Today' : DAY_FMT.format(noonOf(this.selected));
    head.createSpan({ cls: 'dg-agenda-heading-date', text: label });
    const open = items.filter((i) => !i.completed).length;
    head.createSpan({ cls: 'dg-agenda-heading-count', text: items.length ? `${open} open of ${items.length}` : '' });

    if (this.selected < from || this.selected > to) {
      root.createDiv({ cls: 'dg-agenda-empty', text: `Only ${AGENDA_WINDOW_DAYS} days either side of today are loaded here. Open dayGLANCE for the rest.` });
      return;
    }
    if (!items.length) {
      root.createDiv({ cls: 'dg-agenda-empty', text: 'Nothing scheduled.' });
    }
    if (items.length) this.renderItems(root, items);
    this.renderRoutines(root, this.store.routinesFor(this.selected));
  }

  private renderItems(root: HTMLElement, items: AgendaItem[]): void {
    const list = root.createEl('ul', { cls: 'dg-agenda-list' });
    for (const item of items) {
      const pending = !item.completed && this.store.isPending(item.id);
      const li = list.createEl('li', { cls: 'dg-agenda-item' });
      if (item.completed) li.addClass('is-done');
      if (pending) li.addClass('is-pending');
      const box = li.createEl('input', { type: 'checkbox' });
      box.checked = item.completed || pending;
      // Completion only, and only from here for dayGLANCE-owned items:
      // imported calendar events are completed in dayGLANCE (their
      // completion lives in a different store); a done box stays done.
      box.disabled = item.completed || pending || !!item.imported;
      if (item.imported) box.setAttr('title', 'Imported calendar event: complete it in dayGLANCE');
      box.addEventListener('change', () => {
        if (!box.checked) return;
        box.disabled = true;
        void this.store.complete(item).then((r) => {
          if (!r.ok) { new Notice(`dayGLANCE: ${r.message}`); this.render(); }
        });
      });
      const swatch = swatchColor(item.color);
      if (swatch) li.createDiv({ cls: 'dg-agenda-swatch' }).style.background = swatch;
      const body = li.createDiv({ cls: 'dg-agenda-body' });
      if (!item.isAllDay && item.startTime) {
        const end = item.duration ? endOf(item.startTime, item.duration) : null;
        body.createSpan({ cls: 'dg-agenda-time', text: end ? `${formatTime(item.startTime)} to ${end}` : formatTime(item.startTime) });
      }
      const title = body.createSpan({ cls: 'dg-agenda-title' });
      this.renderTitle(title, item.title);
      if (item.recurring) title.createSpan({ cls: 'dg-agenda-badge', text: '↻', attr: { title: 'Recurring' } });
      if (item.imported) title.createSpan({ cls: 'dg-agenda-badge', text: '📅', attr: { title: item.calendarName ? `Calendar: ${item.calendarName}` : 'Imported calendar event' } });
    }
  }

  // Tags faded and italic; wikilinks shown as their display text and
  // clickable (mod-click opens in a new leaf, like Obsidian's own links).
  private renderTitle(el: HTMLElement, title: string): void {
    for (const seg of splitTitle(title)) {
      if (seg.type === 'text') { el.appendText(seg.text); continue; }
      if (seg.type === 'tag') { el.createSpan({ cls: 'dg-agenda-tag', text: seg.text }); continue; }
      const a = el.createEl('a', { cls: 'dg-agenda-link', text: seg.text, attr: { 'aria-label': `Open ${seg.target}` } });
      a.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void this.app.workspace.openLinkText(seg.target, '', Keymap.isModEvent(evt));
      });
    }
  }

  // The day's placed routines, visually a different species from tasks: a
  // strip of pills (no checkbox, no swatch), name and start time only.
  // Routines are day-scoped in dayGLANCE (placed each morning, cleared at
  // midnight), so only the stamped day ever has any.
  private renderRoutines(root: HTMLElement, routines: RoutineItem[]): void {
    if (!routines.length) return;
    root.createDiv({ cls: 'dg-agenda-routines-heading', text: 'Routines' });
    const list = root.createEl('ul', { cls: 'dg-agenda-routines' });
    for (const r of routines) {
      const li = list.createEl('li', { cls: 'dg-agenda-routine' });
      if (r.completed) li.addClass('is-done');
      li.createSpan({ cls: 'dg-agenda-routine-dot' });
      if (r.startTime) li.createSpan({ cls: 'dg-agenda-routine-time', text: formatTime(r.startTime) });
      li.createSpan({ cls: 'dg-agenda-routine-name', text: r.name });
      li.setAttr('title', r.startTime ? `${r.name} at ${formatTime(r.startTime)}` : `${r.name} (any time)`);
    }
  }

  private renderStatus(root: HTMLElement, status: ReturnType<AgendaStore['getStatus']>): void {
    const parts: string[] = [];
    if (status.refreshing) parts.push('Refreshing…');
    else if (status.lastRefreshedAt) parts.push(`Updated ${relativeAge(status.lastRefreshedAt)}`);
    else parts.push('Loading…');
    if (status.undecryptable) parts.push(`${status.undecryptable} rows unreadable with this passphrase`);
    // Calendar events come from dayGLANCE's projection, not the mirror: say
    // how old that view is once it is stale enough to matter.
    if (status.calendarAsOf && Date.now() - status.calendarAsOf > 60 * 60_000) parts.push(`Calendar as of ${relativeAge(status.calendarAsOf)}`);
    if (status.lastError) parts.push(status.lastError);
    const el = root.createDiv({ cls: 'dg-agenda-status', text: parts.join(' · ') });
    if (status.lastError || status.undecryptable) el.addClass('is-error');
  }
}
