import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createDoRecord } from '../../jobo/core.js';
import { buildJoboDayModel } from '../../jobo/viewModel.js';

// #2278, phase 1 gaps: a timed Do that ran past midnight. The Do side draws it
// on each date it touches, through the real JOBO view: the start date's piece
// stops at midnight with a dashed bottom edge, and the next date's piece runs
// from 00:00 with the Plan side's continuation look (a dashed top edge, an up
// chevron and "from <day>"). Both pieces are the same record: a click opens
// its details, Edit its editor, and the end is resized on the piece that
// holds it, writing the next date's time.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {} }));
vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, o) => (o?.day ? `${key}:${o.day}` : key) }) }));
vi.mock('../DayView.jsx', () => ({ DayViewColumn: () => <div data-plan-column /> }));
import JoboView from '../JoboView.jsx';
import DoColumn from './DoColumn.jsx';

const TUE = '2026-11-03';
const WED = '2026-11-04';
const HOUR = 160; // the scrolling timeline's hour (SCROLLING_HOUR_PX)
const stamp = '2026-11-04T02:00:00-05:00';
const night = (over = {}) => createDoRecord({
  id: 'manual:night', taskId: 't1', title: 'Night shift', source: 'manual', progress: 'completed',
  timing: 'timed', date: TUE, startTime: '23:00', endDate: WED, endTime: '01:30', planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
const task = { id: 't1', title: 'Night shift', date: TUE, startTime: '23:00', duration: 150, color: 'bg-blue-500' };

function setFixture(dateStr, records, extra = {}) {
  const day = new Date(`${dateStr}T12:00:00`);
  fixture.ctx = {
    selectedDate: day, currentTime: new Date('2026-11-10T12:00:00'),
    tasks: [task], unscheduledTasks: [], expandedRecurringTasks: [], recurringTasks: [],
    getTasksForDate: (d) => [task].filter((t) => t.date === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`),
    formatTime: (value) => value,
    textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', darkMode: false,
    calendarRef: { current: null }, stickyHeaderRef: { current: null },
  };
  fixture.features = { joboRecords: records, joboLoaded: true, joboWritable: true, joboError: null, recordJobo: vi.fn(async () => ({ ok: true })), reloadJobo: vi.fn(), ...extra };
}

const cardHtml = (html, id = 'manual:night') => {
  const at = html.indexOf(`data-jobo-record="${id}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<div', at), html.indexOf('data-jobo-record', at + 1) > 0 ? html.indexOf('data-jobo-record', at + 1) : undefined);
};

describe('a Do past midnight on the JOBO Do side (#2278)', () => {
  it('the next date draws the after-midnight piece from 00:00, as a continuation of the same record', () => {
    setFixture(WED, [night()]);
    const html = renderToStaticMarkup(<JoboView />);
    const card = cardHtml(html);
    expect(card).toContain(`data-jobo-continues-from="${TUE}"`);
    expect(card).toContain('top:0;');
    expect(card).toContain(`height:${1.5 * HOUR - 2}px`); // 00:00-01:30, less the 2px gap
    expect(card).toContain('border-t-2 border-dashed');
    expect(card).toContain('task.continuesFrom:');
    expect(card).toContain('lucide-chevron-up');
    // Its end is on this date: the resize handle is here.
    expect(card).toContain('w-12 h-1 bg-white rounded-full');
    expect(card).not.toContain('data-jobo-continues-next');
  });

  it('the start date stops it at midnight, dashed, with no resize handle and no Continue', () => {
    setFixture(TUE, [night({ progress: 'started' })]);
    const html = renderToStaticMarkup(<JoboView />);
    const card = cardHtml(html);
    expect(card).toContain('data-jobo-continues-next="true"');
    expect(card).toContain(`top:${23 * HOUR}px`);
    expect(card).toContain(`height:${HOUR - 2}px`);
    expect(card).toContain('border-b-2 border-dashed');
    expect(card).not.toContain('data-jobo-continues-from');
    expect(card).not.toContain('task.continuesFrom');
    expect(card).not.toContain('w-12 h-1 bg-white rounded-full');
    expect(card).not.toContain('data-jobo-continue="true"');
    // The unfinished record is continued from the piece that holds its end.
    setFixture(WED, [night({ progress: 'started' })]);
    expect(cardHtml(renderToStaticMarkup(<JoboView />))).toContain('data-jobo-continue="true"');
  });

  it('a Do that ends exactly at midnight draws no piece on the next date, and keeps its handle', () => {
    const toMidnight = night({ endTime: '00:00' });
    setFixture(WED, [toMidnight]);
    expect(renderToStaticMarkup(<JoboView />)).not.toContain('data-jobo-record=');
    setFixture(TUE, [toMidnight]);
    const card = cardHtml(renderToStaticMarkup(<JoboView />));
    expect(card).not.toContain('data-jobo-continues-next');
    expect(card).toContain('w-12 h-1 bg-white rounded-full');
  });
});

describe('the next date\'s piece acts on the record itself', () => {
  const itemsFor = (date, records) => buildJoboDayModel({ date, tasks: [], taskLookup: [task], records }).timedRecords;

  it('a click opens its details, Edit its editor, the handle its resize: the same record each time', () => {
    const record = night();
    const [item] = itemsFor(WED, [record]);
    const onDetails = vi.fn(); const onEdit = vi.fn(); const onResizeGesture = vi.fn();
    let root;
    act(() => {
      root = create(
        <DoColumn date={WED} hourHeight={60} items={[item]} ctx={fixture.ctx} t={(k) => k} writable
          pendingIds={[]} preview={null} onAddAt={() => {}} onEdit={onEdit} onKeep={() => {}} onContinue={() => {}}
          onDetails={onDetails} onPointGesture={() => {}} onResizeGesture={onResizeGesture} />,
      );
    });
    const card = root.root.find((n) => n.props['data-jobo-record'] === record.id);
    const stop = { stopPropagation: () => {}, target: { closest: () => null } };
    act(() => card.props.onClick(stop));
    expect(onDetails.mock.calls[0][0].record).toBe(record);
    const edit = root.root.find((n) => n.type === 'button' && n.props['aria-label'] === `common.edit: ${record.title}`);
    act(() => edit.props.onClick(stop));
    expect(onEdit).toHaveBeenCalledWith(record);
    const handle = root.root.find((n) => n.props.className?.includes?.('cursor-ns-resize') && n.props.onPointerDown && n !== card);
    act(() => handle.props.onPointerDown(stop));
    expect(onResizeGesture.mock.calls[0][1].record).toBe(record);
  });
});

describe('resizing the end on the next date\'s piece writes that date\'s time', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drags 01:30 to 02:00 on Wednesday: the record ends Wednesday 02:00, its start untouched', async () => {
    const record = night();
    setFixture(WED, [record]);
    const listeners = {};
    vi.stubGlobal('window', {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type) => { delete listeners[type]; },
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
      innerWidth: 1280, innerHeight: 800,
    });
    let root;
    await act(async () => {
      root = create(<JoboView />, {
        createNodeMock: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0, width: 400, height: 3840 }), scrollTop: 0, clientHeight: 800, addEventListener: () => {}, removeEventListener: () => {} }),
      });
    });
    const card = root.root.find((n) => n.props['data-jobo-record'] === record.id);
    const handle = card.find((n) => n.props.className?.includes?.('cursor-ns-resize') && n.props.onPointerDown && n !== card);
    const at = (minute) => ({ button: 0, clientY: minute / 60 * HOUR, preventDefault: () => {}, stopPropagation: () => {} });
    act(() => handle.props.onPointerDown(at(90)));
    await act(async () => { listeners.pointermove?.(at(120)); await listeners.pointerup?.(at(120)); });
    const { recordJobo } = fixture.features;
    expect(recordJobo).toHaveBeenCalled();
    const written = recordJobo.mock.calls.at(-1).flat().find((r) => r && r.id === record.id);
    expect(written).toMatchObject({ date: TUE, startTime: '23:00', endDate: WED, endTime: '02:00' });
  });
});
