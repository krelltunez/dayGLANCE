import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { continuationsFromPreviousDay } from '@glance-apps/agenda-core';

// #2278: the piece of a task after midnight is a view of the task. Every
// gesture on it reaches the handler the task's own card uses, with the task
// itself (the same object), never a copy placed at 00:00.

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, o) => (o?.day ? `${key}:${o.day}` : key) }) }));

const fixture = vi.hoisted(() => ({ ctx: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));

import ContinuationCard from './ContinuationCard.jsx';

const TUE = '2026-11-03';
const WED = '2026-11-04';

function setup(task, over = {}) {
  fixture.ctx = {
    darkMode: false, isTablet: false, currentTime: new Date(`${WED}T09:00:00`),
    openMobileEditTask: vi.fn(), toggleComplete: vi.fn(),
    handleDragStart: vi.fn(), handleDragEnd: vi.fn(),
    handleResizeStart: vi.fn(), handleTouchResizeStart: vi.fn(),
    handleMobileTaskTouchStart: vi.fn(), handleMobileTaskTouchMove: vi.fn(), handleMobileTaskTouchEnd: vi.fn(),
    getTaskCalendarStyle: () => ({}), setTaskContextMenu: vi.fn(),
    ...over,
  };
  const [continuation] = continuationsFromPreviousDay([task]);
  let root;
  act(() => {
    root = create(
      <ContinuationCard continuation={continuation} dateStr={WED} top={0} height={60} hourHeight={60} {...(over.props || {})} />,
    );
  });
  const card = root.root.find((n) => n.props['data-continuation-from'] !== undefined);
  return { root, card, continuation, ctx: fixture.ctx };
}

const night = (over = {}) => ({ id: 't1', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, color: 'bg-blue-500', ...over });
const ev = (target = {}) => ({ stopPropagation: vi.fn(), preventDefault: vi.fn(), target: { matches: () => false, parentElement: null, ...target }, currentTarget: {} });

describe('ContinuationCard', () => {
  it('draws the task\'s colour and title, marked as continuing from its start day', () => {
    const { card, root } = setup(night());
    expect(card.props.className).toContain('bg-blue-500');
    expect(card.props['data-continuation-from']).toBe(TUE);
    expect(card.props['data-task-id']).toBe('t1');
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Night shift');
    expect(text).toMatch(/task\.continuesFrom:\S+/);
  });

  it('a click opens the task\'s editor with the task itself', () => {
    const task = night();
    const { card, ctx } = setup(task);
    act(() => card.props.onClick(ev()));
    expect(ctx.openMobileEditTask).toHaveBeenCalledTimes(1);
    expect(ctx.openMobileEditTask.mock.calls[0][0]).toBe(task);
  });

  it('its checkbox completes the task (its own id) and opens nothing', () => {
    const task = night({ id: `recurring-s-${TUE}`, isRecurring: true });
    const { root, ctx } = setup(task);
    const box = root.root.find((n) => n.props['data-continuation-checkbox'] !== undefined);
    act(() => box.props.onClick(ev()));
    expect(ctx.toggleComplete).toHaveBeenCalledWith(`recurring-s-${TUE}`);
    expect(ctx.openMobileEditTask).not.toHaveBeenCalled();
  });

  it('a drag moves the task itself, as the start-day card\'s drag does', () => {
    const task = night();
    const { card, ctx } = setup(task);
    expect(card.props.draggable).toBe(true);
    const e = ev();
    card.props.onDragStart(e);
    expect(ctx.handleDragStart).toHaveBeenCalledWith(task, 'calendar', e);
    expect(ctx.handleDragStart.mock.calls[0][0]).toBe(task);
  });

  it('only its bottom edge resizes, at the view\'s hour height; its top edge (midnight) does not', () => {
    const task = night();
    const { root, ctx } = setup(task);
    expect(root.root.findAll((n) => n.props['data-resize-handle'] === 'top')).toHaveLength(0);
    const bottom = root.root.find((n) => n.props['data-resize-handle'] === 'bottom');
    const e = ev();
    bottom.props.onMouseDown(e);
    expect(ctx.handleResizeStart).toHaveBeenCalledWith(task, e, { hourHeight: 60 });
    bottom.props.onTouchStart(e);
    expect(ctx.handleTouchResizeStart).toHaveBeenCalledWith(task, e, { hourHeight: 60 });
  });

  it('a DAY slice that does not hold the end has no resize handle', () => {
    const { root } = setup(night(), { props: { showResize: false } });
    expect(root.root.findAll((n) => n.props['data-resize-handle'] === 'bottom')).toHaveLength(0);
  });

  it('its menu finds the task on the date it started', () => {
    const { card, ctx } = setup(night());
    card.props.onContextMenu({ ...ev(), clientX: 1, clientY: 2 });
    expect(ctx.setTaskContextMenu).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', dateStr: TUE }));
  });

  it('a read-only calendar event shows its piece but cannot be completed, dragged, resized or opened', () => {
    const { root, card, ctx } = setup(night({ imported: true, color: 'bg-gray-600' }));
    expect(card.props.draggable).toBe(false);
    expect(root.root.findAll((n) => n.props['data-continuation-checkbox'] !== undefined)).toHaveLength(0);
    expect(root.root.findAll((n) => n.props['data-resize-handle'] === 'bottom')).toHaveLength(0);
    act(() => card.props.onClick(ev()));
    expect(ctx.openMobileEditTask).not.toHaveBeenCalled();
  });

  it('a completed task\'s piece is shown, as completed', () => {
    const { card, root } = setup(night({ completed: true }));
    expect(card.props.className).toContain('opacity-50');
    expect(JSON.stringify(root.toJSON())).toContain('line-through');
  });

  it('on the phone, its tab long-press-drags the task from 00:00 of the date it is drawn on', () => {
    const task = night();
    const { root, ctx } = setup(task, { props: { variant: 'touch' } });
    const tab = root.root.find((n) => n.props['data-drag-handle'] !== undefined);
    const e = ev();
    tab.props.onTouchStart(e);
    expect(ctx.handleMobileTaskTouchStart).toHaveBeenCalledWith(e, task, 'timeline', { anchor: { startTime: '00:00', date: WED } });
    tab.props.onTouchEnd(e);
    expect(ctx.handleMobileTaskTouchEnd).toHaveBeenCalledWith(e, 't1', 'timeline');
  });
});
