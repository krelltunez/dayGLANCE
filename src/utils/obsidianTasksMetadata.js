// Moved to @glance-apps/obsidian-format (packages/obsidian-format — the
// shared vault line-format core; format, never policy). This shim keeps the
// historical import path working; new code should import the package.
export { splitTasksMetadata, reattachTasksMetadata } from '@glance-apps/obsidian-format';
