# dayGLANCE Bridge

Connects an Obsidian vault to [dayGLANCE](https://github.com/krelltunez/dayGLANCE),
a privacy-first day planner. The plugin shows your dayGLANCE agenda in
Obsidian's sidebar and keeps tasks in your daily notes, chosen folders and
project notes in step with the planner, including while dayGLANCE is closed.

dayGLANCE can already read and write a vault folder without this plugin. The
plugin adds what a folder cannot do on its own: it runs inside Obsidian.

## Features

- **Agenda sidebar.** A month calendar over the selected day's scheduled
  tasks, recurring tasks and calendar events, with the day's routines
  underneath. Tick a task to complete it in dayGLANCE. Open it from the
  ribbon icon or the **Open agenda** command.
- **Tasks beyond daily notes.** Choose folders or tags whose notes are task
  sources. Their open tasks, and tasks completed within a window you choose
  (7 to 90 days), become dayGLANCE tasks.
- **Project and goal notes.** Link a note to a dayGLANCE project or goal. The
  link survives renames and moves. The project's tasks live in a `## Tasks`
  section of its note, and a small `dayglance:` frontmatter map keeps its
  status (and, for a project, its goal) up to date for Dataview queries.
  dayGLANCE can also create the note for a new project or goal, from your
  own template if you have one (Templater is supported).
- **Changes from dayGLANCE applied in the vault.** Completions, edits and new
  tasks made in dayGLANCE are written into the right note. When the same
  vault is open on several computers, only one of them writes at a time, and
  the others receive the result through Obsidian Sync.
- **Add to dayGLANCE.** Select text in any note and choose **Add to
  dayGLANCE** from the editor's context menu, or run the **Add selection or current line to dayGLANCE as a task** command
  (with nothing selected, it starts from the line the cursor is on). On a
  phone or tablet, a long press shows the system's copy menu instead of
  Obsidian's, so use the command: add it to the mobile toolbar (Settings,
  Toolbar) for one tap. The text becomes one dayGLANCE inbox task, with an optional deadline, priority and project,
  linked back to the note with a `[[wikilink]]`. Any paired dayGLANCE device
  adds it, including a phone without access to the vault folder. The task is
  sent to dayGLANCE and appears there once dayGLANCE picks it up on one of
  your devices. This needs a recent dayGLANCE on at least one device: until
  one has run, the form says so and sends nothing (and does not touch the
  note). If a task you sent has not been picked up after an hour, the agenda
  sidebar says so, with a hint to open or update dayGLANCE.
- **Tidy editor.** Optionally hide the `^dg-…` ids dayGLANCE adds to task
  lines, and hide completed tasks in linked project and goal notes. Both are
  display only and never change a note.

## Requirements

- **dayGLANCE**, free on the web at [dayglance.app](https://dayglance.app) or
  self-hosted, and in the desktop and mobile apps.
- **A self-hosted GLANCEvault server**, dayGLANCE's sync server, with
  dayGLANCE syncing to it. The plugin talks to the same server. There is no
  hosted GLANCEvault and no account with the plugin's author.
- Obsidian 1.7.2 or later, on desktop or mobile. Live updates use a
  persistent connection on desktop; on mobile the plugin checks every 30
  seconds while Obsidian is open.

## Setup

1. Install **dayGLANCE Bridge** from Obsidian's community plugins and enable it.
2. In dayGLANCE, open **Settings → Obsidian → Bridge plugin** and start
   pairing. dayGLANCE shows a one-time code and leaves a sealed pairing offer
   in your vault.
3. In Obsidian, enter the code in **Settings → dayGLANCE Bridge** or with the
   **Enter pairing code** command.
4. For the agenda, enter your dayGLANCE sync passphrase once on each device,
   under **dayGLANCE account** in the plugin's settings.

## Commands

- **Sync now**: apply pending changes from dayGLANCE and report this copy as
  running.
- **Enter pairing code**
- **Unpair from GLANCEvault**: forget this vault's pairing and the account
  key on this device. Revoke the device token on your server as well.
- **Open agenda**
- **Link current note to a dayGLANCE project or goal**
- **Unlink current note from dayGLANCE**
- **Add selection or current line to dayGLANCE as a task**: the selection, or the line the cursor is on; give it a hotkey,
  or a button in the mobile toolbar. The same form as the context-menu item. The
  project list appears once the sync passphrase is entered on this device.
  The form checks that a dayGLANCE app new enough to receive the task has
  run on one of your devices; until then (or while GLANCEvault cannot be
  reached) it explains why and **Add** stays disabled. A sent task reads
  "Sent to dayGLANCE".

## Settings for Add to dayGLANCE

- **Link to the exact paragraph** (off by default): link the task to the
  paragraph or list item the selection starts in, as `[[Note#^id]]`, instead
  of the whole note. A block id already at the end of that block is reused;
  otherwise the plugin adds a short one there, which edits the note (undo
  removes it). A dayGLANCE task line, headings, code, quotes and tables link
  to the note.

## Privacy, network use and what the plugin stores

- **Network.** The plugin makes requests only while paired (and once to
  verify a pairing), and only to the GLANCEvault server address carried in
  the pairing. It contacts no other service and collects no telemetry.
- **Encryption.** Changes exchanged with dayGLANCE are encrypted with
  AES-256-GCM before they leave the device. The agenda reads your tasks with
  a key derived from your sync passphrase. A few small records are stored
  on your server unencrypted, because devices need them before they can
  decrypt anything:
  - the pairing record: when the vault was paired, the pairing's (non-secret)
    salt, whose agenda the vault shows, and the task-source settings,
    including the folder names and tags you chose;
  - which copy of the vault applies changes;
  - for each copy, its computer name (the platform on mobile), plugin version
    and pairing status.
- **Files in your vault.**
  - The plugin lists the vault's Markdown files to find the notes in your
    task sources, and checks each note's frontmatter (through Obsidian's
    metadata cache) for its `dayglance-id` key, which is how a linked project
    or goal note is found again after it is renamed or moved. It reads the
    content only of the notes it works with: daily notes, notes in your chosen
    folders or tags, and linked notes.
  - `.dayglance/heartbeat`: rewritten every 30 seconds while Obsidian is open,
    so dayGLANCE knows the plugin is running. Dot-folders are ignored by
    search, the graph and Obsidian Sync.
  - `.dayglance/pairing`: the pairing offer dayGLANCE leaves. The plugin
    deletes it after use.
  - Your notes: task lines, daily notes and project or goal notes the plugin
    writes on dayGLANCE's behalf, a `^dg-…` id at the end of each task line it
    tracks, the `dayglance-id` and `dayglance:` frontmatter keys on linked
    notes, and, with **Link to the exact paragraph** on, a block id at the end
    of a paragraph you add to dayGLANCE. Nothing outside the vault is read or
    written.
- **Settings and keys.**
  - The pairing (server address, device token and an encryption key) and your
    settings are stored in the plugin's `data.json`, which Obsidian Sync
    copies to your other devices if you sync plugin settings. That is how one
    pairing serves every copy of the vault.
  - The account key derived from your passphrase stays on the device that
    entered it, in the plugin's IndexedDB store. Neither the passphrase nor
    the key is written to `data.json`.
  - Per device, outside `data.json` (Obsidian's device-local storage): the
    plugin's sync position, whether your dayGLANCE apps can receive tasks
    added from Obsidian, and the tasks this device sent that dayGLANCE has
    not picked up yet (their titles and when they were sent), until it does.
- **No ads and no payments.** The plugin is free and open source (MIT).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for how the plugin works, its test
harness and how to build it.

## License

MIT
