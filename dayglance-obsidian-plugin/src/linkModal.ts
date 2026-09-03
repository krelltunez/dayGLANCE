// The "link this note" picker (companion spec §4.3, ruling A): a fuzzy list
// of the mirror's active projects and goals. Choosing one writes the
// entity's id into the current note's frontmatter (bridge.ts linkNote).
import { App, FuzzySuggestModal } from 'obsidian';
import type { LinkTarget } from './agenda';

export class LinkTargetModal extends FuzzySuggestModal<LinkTarget> {
  constructor(app: App, private readonly targets: LinkTarget[], private readonly onChoose: (t: LinkTarget) => void) {
    super(app);
    this.setPlaceholder('Link this note to a dayGLANCE project or goal');
  }
  getItems(): LinkTarget[] { return this.targets; }
  getItemText(t: LinkTarget): string {
    return t.kind === 'goal' ? `${t.title} (goal)` : (t.goalTitle ? `${t.title} (${t.goalTitle})` : t.title);
  }
  onChooseItem(t: LinkTarget): void { this.onChoose(t); }
}
