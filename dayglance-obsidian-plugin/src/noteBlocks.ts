// The maintained `dayglance:` frontmatter block on linked project and goal
// notes (companion spec §4.3, rulings B and C).
//
// Rendered HERE, from the mirror the agenda store already holds, on the
// plugin's tick and after every successful drain; written only when the
// rendered block differs from the one in the file, at most once per
// BLOCK_WRITE_FLOOR_MS per note, never into a dirty editor buffer. Only the
// `dayglance` key is touched (Obsidian's frontmatter API rewrites the block
// in place and leaves every other key alone).
import { App, TFile } from 'obsidian';
import { NOTE_BLOCK_KEY, projectNoteBlock, goalNoteBlock, noteBlockChanged, withUpdatedStamp, localDateStr } from '@glance-apps/agenda-core';

const BLOCK_WRITE_FLOOR_MS = 5 * 60_000;

interface Row { id: string; [k: string]: unknown }

export interface NoteBlockHost {
  app: App;
  paired(): boolean;
  /** path → dayGLANCE id of every linked note (bridge.ts). */
  linkedNotes(): ReadonlyMap<string, string>;
  /** The mirror's rows: every task (scheduled and inbox), every project, every goal. */
  blockInputs(): { tasks: Row[]; projects: Row[]; goals: Row[] };
  /** True when an editor holds unsaved changes for the note. */
  bufferDirty(path: string): Promise<boolean>;
}

export class NoteBlockWriter {
  private lastWrite = new Map<string, number>();
  private running = false;
  private disposed = false;

  constructor(private readonly host: NoteBlockHost) {}

  dispose(): void { this.disposed = true; }

  /** One pass over every linked note. Safe to call often; cheap when nothing changed. */
  async tick(): Promise<void> {
    if (this.disposed || this.running || !this.host.paired()) return;
    this.running = true;
    try {
      const linked = this.host.linkedNotes();
      if (!linked.size) return;
      const { tasks, projects, goals } = this.host.blockInputs();
      const projectById = new Map(projects.map((p) => [String(p.id), p]));
      const goalById = new Map(goals.map((g) => [String(g.id), g]));
      const pathOf = new Map<string, string>();
      for (const [path, id] of linked) pathOf.set(id, path);
      const today = localDateStr(new Date());
      const nowIso = new Date().toISOString();
      for (const [path, id] of linked) {
        if (this.disposed) return;
        const project = projectById.get(id);
        const goal = project ? undefined : goalById.get(id);
        if (!project && !goal) continue; // not (yet) in the mirror
        const file = this.host.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        const next = project
          ? projectNoteBlock(project, { tasks, today })
          : goalNoteBlock(goal as Row, { projects, tasks, notePathOf: (pid) => pathOf.get(pid) ?? null });
        const prev = this.host.app.metadataCache.getFileCache(file)?.frontmatter?.[NOTE_BLOCK_KEY] ?? null;
        if (!noteBlockChanged(prev, next)) continue;
        const last = this.lastWrite.get(path) ?? 0;
        if (Date.now() - last < BLOCK_WRITE_FLOOR_MS) continue; // the floor: the next tick past it writes
        if (await this.host.bufferDirty(path)) continue;        // unsaved keystrokes: never merge into them
        const stamped = withUpdatedStamp(prev, next, nowIso);
        try {
          await this.host.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm[NOTE_BLOCK_KEY] = stamped;
          });
          this.lastWrite.set(path, Date.now());
        } catch (e) {
          console.warn(`dayGLANCE bridge: could not update the block in ${path}`, e);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
