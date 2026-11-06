// The "Add to dayGLANCE" form (companion spec 4.2.1): the title prefilled
// from the selection, and the inbox fields dayGLANCE's own form offers, in
// its words and on its scale. The project field is shown only when the
// mirror can list projects (the passphrase is set on this device). As in
// dayGLANCE, priority is not offered for a project task. The work is done by
// the caller's onSubmit (addSelectionAsTask); the form stays open when it
// refuses, so nothing typed is lost.
import { App, Modal, Notice, Setting } from 'obsidian';
import type { ProjectChoice } from './agenda';
import { PRIORITY_LABELS, normalizeTitle, validDeadline, type AddTaskValues } from './addTask';

export interface AddTaskModalOptions {
  title: string;
  /** Null: no mirror, so no project field. */
  projects: ProjectChoice[] | null;
  /** Resolves true when the task was sent (the form then closes). */
  onSubmit: (values: AddTaskValues) => Promise<boolean>;
}

export class AddTaskModal extends Modal {
  private values: AddTaskValues;
  private busy = false;

  constructor(app: App, private readonly opts: AddTaskModalOptions) {
    super(app);
    this.values = { title: opts.title, deadline: null, priority: 0, projectId: null };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle('Add to dayGLANCE');

    new Setting(contentEl)
      .setName('Title')
      .addTextArea((text) => {
        text.setValue(this.values.title).onChange((v) => { this.values.title = v; });
        text.inputEl.rows = 3;
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.submit(); }
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .setName('Deadline')
      .setDesc('Optional.')
      .addText((text) => {
        text.inputEl.type = 'date';
        text.onChange((v) => { this.values.deadline = v || null; });
      });

    const priority = new Setting(contentEl)
      .setName('Priority')
      .addDropdown((dd) => {
        for (let i = 0; i < PRIORITY_LABELS.length; i++) dd.addOption(String(i), PRIORITY_LABELS[i]);
        dd.setValue('0').onChange((v) => { this.values.priority = Number(v) || 0; });
      });

    if (this.opts.projects) {
      new Setting(contentEl)
        .setName('Project')
        .setDesc(this.opts.projects.length ? 'Optional.' : 'No active projects in dayGLANCE.')
        .addDropdown((dd) => {
          dd.addOption('', 'No project');
          for (const p of this.opts.projects ?? []) dd.addOption(p.id, p.goalTitle ? `${p.title} (${p.goalTitle})` : p.title);
          dd.setValue('').onChange((v) => {
            this.values.projectId = v || null;
            // dayGLANCE's form: priority is not available for project tasks.
            priority.setDisabled(!!this.values.projectId);
            if (this.values.projectId) this.values.priority = 0;
          });
        });
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((btn) => btn.setButtonText('Add').setCta().onClick(() => { void this.submit(); }));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (!normalizeTitle(this.values.title)) { new Notice('Enter a title for the task.'); return; }
    if (this.values.deadline && !validDeadline(this.values.deadline)) { new Notice('The deadline is not a valid date.'); return; }
    this.busy = true;
    try {
      if (await this.opts.onSubmit({ ...this.values })) this.close();
    } finally {
      this.busy = false;
    }
  }
}
