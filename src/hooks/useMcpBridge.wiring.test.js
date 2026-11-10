import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// App.jsx wiring the unit tests cannot reach. Routines and frames have one
// owner (ownerSyncId), which isVisibleForUser does not understand, so another
// member's routines and frames leak onto this user's MCP read surface unless
// they are scoped by owner before the read model sees them. That scoping is
// buildMcpReadState's (@glance-apps/dayglance-mcp; its tests pin the scoping
// and mutation-check it). What is left to App, and pinned here, is that the
// bridge answers from buildMcpReadState's state, for this user. Each edit
// these guard against leaves every other test green:
//   - handing useMcpBridge a hand-built object again, with nothing scoping it
//   - dropping userSyncId, which makes isOwnedBy admit every member's items
//   - renaming the slices, which silently empties routines or frames

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const memoStart = app.indexOf('const mcpReadState = useMemo(() => buildMcpReadState({');
const memo = app.slice(memoStart, app.indexOf('useMcpBridge(', memoStart));

describe('App.jsx hands the MCP bridge buildMcpReadState\'s state', () => {
  it('builds the bridge state with buildMcpReadState, in a memo, and passes exactly that', () => {
    expect(memoStart).toBeGreaterThan(-1);
    expect(app).toContain("import { buildMcpReadState } from '@glance-apps/dayglance-mcp/model';");
    expect(app).toMatch(/\n\s*useMcpBridge\(mcpReadState, \{/);
    expect(app).not.toContain('useMcpBridge({');
  });

  it('names the user the read surface answers as', () => {
    expect(memo).toMatch(/\n\s*userSyncId: meUserSyncId,/);
  });

  it('hands over every member\'s routines and frames under their payload names, for buildMcpReadState to scope', () => {
    expect(memo).toMatch(/\n\s*todayRoutines: allTodayRoutines,/);
    expect(memo).toMatch(/\n\s*gtdFrames,/);
    // Frame sets (#2305): without them every set's frames reach every date.
    expect(memo).toMatch(/\n\s*frameSets,/);
    // The pre-package keys would bypass the scoping entirely.
    expect(memo).not.toMatch(/\n\s*routines:/);
    expect(memo).not.toMatch(/\n\s*frames:/);
  });

  it('reads the clock from the ticking currentTime, with no zone (this device\'s clock is the user\'s)', () => {
    expect(memo).toMatch(/\n\s*now: currentTime,/);
    expect(memo).not.toMatch(/timeZone:/);
  });
});

describe('the UI frame wrapper is owner-scoped too', () => {
  it('pins getFrameInstancesForDate in App.jsx to an owner-scoped list', () => {
    // The UI path has the same exposure: getFrameInstancesForDate must filter
    // by ownedBy before handing the roster to the pure module, which by
    // contract does not scope.
    const wrapper = app.slice(app.indexOf('const getFrameInstancesForDate'), app.indexOf('const getFrameInstancesForDate') + 500);
    expect(wrapper).toContain('ownedBy(f, meUserSyncId)');
  });

  it('passes the frame sets, and recomputes when they change (#2305)', () => {
    const wrapper = app.slice(app.indexOf('const getFrameInstancesForDate'), app.indexOf('const getFrameInstancesForDate') + 500);
    expect(wrapper).toContain('{ frameSets }');
    expect(wrapper).toMatch(/\[gtdFrames, frameSets,/);
  });
});

// The default task duration (#2367) is a per-device setting in localStorage,
// not React state: the bridge reads it per write, as it reads retiredTaskIds,
// and the write model hands it to the create and schedule mutations. Dropping
// it leaves every model test green and turns each MCP create back to 30.
describe('the MCP bridge hands writes the default task duration', () => {
  const bridge = readFileSync(new URL('./useMcpBridge.js', import.meta.url), 'utf8');
  const model = readFileSync(new URL('../utils/mcpWriteModel.js', import.meta.url), 'utf8');

  it('reads it per write into the state the write model sees', () => {
    expect(bridge).toContain("import { readDefaultTaskDuration } from '../utils/defaultTaskDuration.js';");
    expect(bridge).toMatch(/const live = \{ \.\.\.stateRef\.current,[^}]*defaultTaskDuration: readDefaultTaskDuration\(\)/);
  });

  it('passes it to create_task and schedule_task', () => {
    expect(model).toContain('applyCreateTask(state, { ...params, defaultDurationMinutes: state.defaultTaskDuration, nowIso })');
    expect(model).toContain('applyScheduleTask(state, { ...params, defaultDurationMinutes: state.defaultTaskDuration, nowIso })');
  });
});
