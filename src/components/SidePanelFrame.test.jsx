import React from 'react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import SidePanelFrame, { SIDE_PANEL_WIDTH } from './SidePanelFrame.jsx';

const render = (collapsed) => renderToStaticMarkup(
  <SidePanelFrame collapsed={collapsed}><div data-panel style={{ width: '340px' }}>Inbox</div></SidePanelFrame>,
);

describe('SidePanelFrame (#2407)', () => {
  it('open, it is the panel\'s width and adds nothing else', () => {
    const html = render(false);
    expect(html).toContain('data-side-panel-frame="open"');
    expect(html).toContain(`width:${SIDE_PANEL_WIDTH}px`);
    // No clipping: the panel's popovers reach past its edge.
    expect(html).not.toContain('overflow');
    expect(html).not.toContain('visibility');
    expect(html).not.toContain('inert');
    expect(html).not.toContain('aria-hidden');
  });

  it('collapsed, it takes no room and the panel is out of sight, focus and the accessibility tree', () => {
    const html = render(true);
    expect(html).toContain('data-side-panel-frame="collapsed"');
    expect(html).toMatch(/style="width:0;height:100%;overflow:hidden;visibility:hidden"/);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
  });

  it('keeps the panel mounted and at its own width either way', () => {
    for (const collapsed of [false, true]) {
      expect(render(collapsed)).toContain('<div data-panel="true" style="width:340px">Inbox</div>');
    }
  });
});

// Both desktop panels sit in the frame, and the tablet's does not.
describe('where the frame is used', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('the calendar\'s side panel, on the desktop only', () => {
    const layout = read('./DesktopLayout.jsx');
    expect(layout.match(/<SidePanelFrame /g)).toHaveLength(1);
    const desktop = layout.slice(layout.indexOf('{/* Desktop side panel'), layout.indexOf('{/* Calendar area'));
    expect(desktop).toContain('<SidePanelFrame collapsed={sidePanelCollapsed}>');
    const tablet = layout.slice(layout.indexOf('{/* Tablet static side panel */}'), layout.indexOf('{/* Desktop side panel'));
    expect(tablet).not.toContain('SidePanelFrame');
  });

  it('the Goals and Projects sidebar', () => {
    const goals = read('./goals/GoalDashboard.jsx');
    expect(goals).toMatch(/<SidePanelFrame collapsed=\{!!sidePanelCollapsed\}>\s+<div\s+data-goals-sidebar/);
  });

  it('App opens the panel whenever one of its tabs is asked for', () => {
    const app = read('../App.jsx');
    expect(app).toMatch(/const setTabletActiveTab = useCallback\(\(tab\) => \{\s+expandSidePanel\(\);\s+setTabletActiveTabState\(tab\);/);
    expect(app).toContain('useSidePanelCollapse({ enabled: !isMobile && !isTablet })');
    // Nothing sets the tab around the wrapper.
    expect(app.match(/setTabletActiveTabState\(/g)).toHaveLength(1);
  });

  it('the Goals space opens it for the keys that point at its sidebar', () => {
    const goals = read('./goals/GoalDashboard.jsx');
    expect(goals).toContain('setTab: (tab) => { expandSidePanel?.(); setSidebarTab(tab); },');
    expect(goals).toMatch(/focusFilter: \(\) => \{\s+expandSidePanel\?\.\(\);/);
  });
});
