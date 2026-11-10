import { describe, it, expect, vi } from 'vitest';
import { NEW_PROJECT_ID, createPendingProject, newProjectFields, withPendingProject } from './pendingProject.js';

const goal = { id: 'g1', title: 'Health', color: 'bg-green-500', assignedUserSyncIds: ['u1'] };
const added = () => vi.fn((fields) => ({ ...fields, id: 'p-new', status: 'active' }));

describe('newProjectFields', () => {
  it('takes its colour and users from its goal, as the project form does', () => {
    expect(newProjectFields({ title: ' Run a 10k ', goal })).toEqual({ title: 'Run a 10k', goalId: 'g1', color: 'bg-green-500', assignedUserSyncIds: ['u1'] });
    expect(newProjectFields({ title: 'Solo', goal: null })).toEqual({ title: 'Solo', color: 'bg-blue-500', assignedUserSyncIds: [] });
  });
});

describe('createPendingProject', () => {
  it('leaves a form with no pending project alone, and creates nothing', () => {
    const addProject = added();
    const form = { title: 'x', projectId: 'p1' };
    expect(createPendingProject(form, { addProject })).toEqual({ newTask: form, project: null });
    expect(addProject).not.toHaveBeenCalled();
  });

  // MUTATION: return the form as it is and the placeholder id is saved on
  // the task, which then belongs to a project that does not exist.
  it('creates the named project and puts its id on the task', () => {
    const addProject = added();
    const form = { title: 'Buy shoes', projectId: NEW_PROJECT_ID, newProject: { title: 'Run a 10k', goalId: 'g1' }, color: 'bg-green-500' };
    const { newTask, project } = createPendingProject(form, { addProject, goals: [goal] });
    expect(addProject).toHaveBeenCalledWith({ title: 'Run a 10k', goalId: 'g1', color: 'bg-green-500', assignedUserSyncIds: ['u1'] });
    expect(project.id).toBe('p-new');
    expect(newTask).toEqual({ title: 'Buy shoes', projectId: 'p-new', color: 'bg-green-500' });
  });

  it('never saves the placeholder: with no name, the task has no project and nothing is created', () => {
    const addProject = added();
    const { newTask } = createPendingProject({ title: 'x', projectId: NEW_PROJECT_ID, newProject: { title: '  ' } }, { addProject });
    expect(newTask).toEqual({ title: 'x' });
    expect(addProject).not.toHaveBeenCalled();
  });

  it('a goal that has gone makes a standalone project', () => {
    const addProject = added();
    createPendingProject({ title: 'x', projectId: NEW_PROJECT_ID, newProject: { title: 'P', goalId: 'gone' } }, { addProject, goals: [] });
    expect(addProject.mock.calls[0][0]).not.toHaveProperty('goalId');
  });
});

describe('the new project\'s colour is the one the task shows', () => {
  const goals = [{ id: 'g1', color: 'bg-green-500', assignedUserSyncIds: ['u1'] }, { id: 'g2', color: 'bg-purple-500' }];
  const save = (form) => {
    const addProject = vi.fn((fields) => ({ ...fields, id: 'p-new' }));
    const { newTask } = createPendingProject({ title: 'Task', ...form }, { addProject, goals });
    return { project: addProject.mock.calls[0][0], task: newTask };
  };

  // MUTATION: stamp the goal's (or the default) colour on choosing "New
  // project…" and a colour picked first is wiped, as reported on #1924.
  it('a colour picked first survives choosing "New project…", and is the project\'s', () => {
    const form = withPendingProject({ title: 'Task', color: 'bg-rose-500' }, { title: 'Garden', goalId: '' }, goals);
    expect(form.color).toBe('bg-rose-500');
    const { project, task } = save(form);
    expect(project.color).toBe('bg-rose-500');
    expect(task.color).toBe('bg-rose-500');
  });

  // MUTATION: create the project from its goal alone and a colour picked
  // after choosing "New project…" leaves the project blue.
  it('a colour picked after choosing "New project…" is the project\'s', () => {
    const form = { ...withPendingProject({ title: 'Task' }, { title: 'Garden', goalId: '' }, goals), color: 'bg-amber-500' };
    expect(save(form).project.color).toBe('bg-amber-500');
  });

  it('a goal\'s colour fills in where none was picked, follows the goal, and is the project\'s', () => {
    let form = withPendingProject({ title: 'Task' }, { title: 'Garden', goalId: '' }, goals);
    expect(form.color).toBeUndefined();
    form = withPendingProject(form, { ...form.newProject, goalId: 'g1' }, goals);
    expect(form.color).toBe('bg-green-500');
    expect(form.assignedUserSyncIds).toEqual(['u1']);
    form = withPendingProject(form, { ...form.newProject, goalId: 'g2' }, goals);
    expect(form.color).toBe('bg-purple-500');
    form = withPendingProject(form, { ...form.newProject, goalId: '' }, goals);
    expect(form.color).toBeUndefined();
    expect(save(withPendingProject(form, { ...form.newProject, goalId: 'g2' }, goals)).project.color).toBe('bg-purple-500');
  });

  it('a goal never overwrites a picked colour, before or after it is chosen', () => {
    let form = withPendingProject({ title: 'Task', color: 'bg-rose-500' }, { title: 'Garden', goalId: 'g1' }, goals);
    expect(form.color).toBe('bg-rose-500');
    form = withPendingProject({ ...form, color: 'bg-cyan-500' }, { ...form.newProject, goalId: 'g2' }, goals);
    expect(form.color).toBe('bg-cyan-500');
    expect(save(form).project).toMatchObject({ color: 'bg-cyan-500', goalId: 'g2' });
  });

  it('with no colour picked and no goal, the project and the task are the default blue', () => {
    const { project, task } = save(withPendingProject({ title: 'Task' }, { title: 'Garden', goalId: '' }, goals));
    expect(project.color).toBe('bg-blue-500');
    expect(task.color).toBe('bg-blue-500');
  });
});

// #2336: a project named in the task modal starts with the New task defaults
// its goal (else the goal's area) holds for new projects.
describe('a new project from the task modal and its goal\'s defaults', () => {
  const area = { id: 'a1', taskDefaults: { energy: 'restore', notes: 'Why:' } };
  const inArea = { ...goal, areaId: 'a1', taskDefaults: { duration: 45 } };

  it('takes the goal\'s, else the area\'s; a standalone project or a goal without any gets no field', () => {
    expect(newProjectFields({ title: 'Run', goal: inArea, area }).taskDefaults).toEqual({ duration: 45, notes: 'Why:', energy: 'restore' });
    expect(newProjectFields({ title: 'Run', goal })).not.toHaveProperty('taskDefaults');
    expect(newProjectFields({ title: 'Solo', goal: null, area })).not.toHaveProperty('taskDefaults');
  });

  it('createPendingProject finds the goal\'s area', () => {
    const addProject = added();
    createPendingProject({ title: 'x', projectId: NEW_PROJECT_ID, newProject: { title: 'Run', goalId: 'g1' } }, { addProject, goals: [inArea], areas: [area] });
    expect(addProject.mock.calls[0][0].taskDefaults).toEqual({ duration: 45, notes: 'Why:', energy: 'restore' });
  });
});

// #2365: a goal's General project, picked under its goal in the task editor.
describe('a pending General project', () => {
  const pending = (over = {}) => ({
    title: 'Plant tomatoes', color: 'bg-red-500', projectId: NEW_PROJECT_ID,
    newProject: { title: 'General', goalId: 'g1', general: true }, ...over,
  });

  it('is made marked as the goal\'s General project, in the goal\'s colour (not one picked for this task)', () => {
    const addProject = added();
    const { newTask, project } = createPendingProject(pending(), { addProject, goals: [goal] });
    expect(addProject).toHaveBeenCalledWith(expect.objectContaining({ title: 'General', goalId: 'g1', goalGeneral: true, color: 'bg-green-500' }));
    expect(newTask).toMatchObject({ projectId: 'p-new', color: 'bg-green-500' });
    expect(newTask.newProject).toBeUndefined();
    expect(project.goalGeneral).toBe(true);
  });

  // MUTATION: drop the lookup and every editor that picked General before the
  // first save landed makes a General project of its own.
  it('if the goal has one by the time the task is saved, that one is used and none is made', () => {
    const addProject = added();
    const existing = { id: 'p-gen', title: 'Odds and ends', goalId: 'g1', goalGeneral: true, status: 'active' };
    const { newTask, project } = createPendingProject(pending(), { addProject, goals: [goal], projects: [existing] });
    expect(addProject).not.toHaveBeenCalled();
    expect(newTask).toMatchObject({ projectId: 'p-gen', color: 'bg-green-500' });
    expect(project).toBe(existing);
  });

  it('a finished General project is not reused: a new one is made', () => {
    const addProject = added();
    const done = { id: 'p-gen', goalId: 'g1', goalGeneral: true, status: 'completed' };
    createPendingProject(pending(), { addProject, goals: [goal], projects: [done] });
    expect(addProject).toHaveBeenCalledTimes(1);
  });

  it('"New project…" makes a plain project, never a General one, and keeps the colour picked', () => {
    const addProject = added();
    const plain = pending({ newProject: { title: 'Run a 10k', goalId: 'g1' } });
    createPendingProject(plain, { addProject, goals: [goal], projects: [{ id: 'p-gen', goalId: 'g1', goalGeneral: true, status: 'active' }] });
    const fields = addProject.mock.calls[0][0];
    expect(fields.goalGeneral).toBeUndefined();
    expect(fields.color).toBe('bg-red-500');
  });

  it('a project needs a goal to be one', () => {
    expect(newProjectFields({ title: 'General', goal: null, general: true }).goalGeneral).toBeUndefined();
    expect(newProjectFields({ title: 'General', goal, general: true }).goalGeneral).toBe(true);
  });
});
