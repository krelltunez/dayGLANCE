import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeFileAtomicSync } from './atomicWrite.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-atomic-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const listAll = () => fs.readdirSync(dir);

describe('writeFileAtomicSync', () => {
  it('creates a new file with the exact content', () => {
    const target = path.join(dir, '2026-08-28.md');
    writeFileAtomicSync(target, '## Tasks\n- [ ] Alpha\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('## Tasks\n- [ ] Alpha\n');
  });

  it('replaces an existing file', () => {
    const target = path.join(dir, 'note.md');
    fs.writeFileSync(target, 'old');
    writeFileAtomicSync(target, 'new content');
    expect(fs.readFileSync(target, 'utf-8')).toBe('new content');
  });

  it('leaves no temp files behind on success', () => {
    const target = path.join(dir, 'note.md');
    writeFileAtomicSync(target, 'a');
    writeFileAtomicSync(target, 'b');
    expect(listAll()).toEqual(['note.md']);
  });

  it('temp files are dot-prefixed while staged, so Obsidian would never index them', () => {
    // Stage a write into a directory whose rename target is occupied by a
    // DIRECTORY — the rename fails, and the catch path must clean the temp
    // file up. Before the failure, everything staged in the dir must be
    // hidden (dot-prefixed).
    const target = path.join(dir, 'occupied');
    fs.mkdirSync(target);
    expect(() => writeFileAtomicSync(target, 'x')).toThrow();
    // Original directory untouched, no stray temp files.
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(listAll()).toEqual(['occupied']);
  });

  it('a failed write leaves the ORIGINAL file intact (no truncate-then-die window)', () => {
    const target = path.join(dir, 'daily.md');
    fs.writeFileSync(target, 'precious original');
    // Force the failure at the rename step: make the temp-file creation
    // succeed but the target un-renamable by replacing it with a non-empty
    // directory (rename onto a dir fails on every platform).
    fs.rmSync(target);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.md'), 'precious original');
    expect(() => writeFileAtomicSync(target, 'new')).toThrow();
    expect(fs.readFileSync(path.join(target, 'keep.md'), 'utf-8')).toBe('precious original');
  });
});
