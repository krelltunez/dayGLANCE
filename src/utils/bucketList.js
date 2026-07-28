// Bucket List — someday/maybe space for pre-commitment tasks.
//
// Bucket items ARE unscheduledTasks (same array, same sync/backup/undo/
// recycle-bin machinery for free) distinguished by a `bucketId` field, and
// EXCLUDED from all Inbox behavior: lists, counts, auto-archive, overdue/
// deadline/priority machinery, frame- and smart-scheduling. The Inbox nags;
// the Bucket doesn't.
//
// Exactly two lists ('b1' | 'b2') — user-editable headings live in the synced
// bucketConfig, the ids are stable. Deliberately capped at two: more lists is
// Kanban sneaking back in.

export const BUCKET_LIST_IDS = ['b1', 'b2'];

export const DEFAULT_BUCKET_CONFIG = {
  // b1 is the demote target and always visible; b2 is hideable. "Anytime"
  // leads (actionable whenever, just not scheduled — where a demoted Inbox
  // task naturally lands) with "Someday" as the further-out, review-
  // occasionally list (the Things 3 convention).
  headings: { b1: 'Anytime', b2: 'Someday' },
  secondListHidden: false,
  notes: '',
};

/** True when a task lives in the Bucket List (any list). */
export const isBucketTask = (task) => !!task?.bucketId;

/**
 * The unconditional Inbox exclusion. Applied at every unscheduledTasks
 * consumer that feeds Inbox lists, counts, or nag machinery — ahead of the
 * feature-gated project filters (unlike hideProjectTasksInbox, this is not
 * user-toggleable).
 */
export const notBucketed = (task) => !task?.bucketId;

/**
 * Demote an Inbox task into the Bucket List (the main entry point in
 * practice). Deadline and priority are STRIPPED — bucket items are
 * pre-commitment, and hidden state that resurfaces as an instantly-overdue
 * nag on promotion would be worse than losing it.
 *
 * @param {object} task  The inbox task.
 * @param {string} [listId]  Target list; defaults to the first list.
 */
export const demoteToBucket = (task, listId = BUCKET_LIST_IDS[0]) => {
  const { deadline, priority, ...rest } = task;
  void deadline; void priority;
  return {
    ...rest,
    bucketId: BUCKET_LIST_IDS.includes(listId) ? listId : BUCKET_LIST_IDS[0],
    lastModified: new Date().toISOString(),
  };
};

/**
 * Promote a bucket item back to the Inbox: drop bucketId, start fresh
 * (priority 0, no deadline — demotion already stripped them, but a synced
 * item from an older client could still carry them).
 */
export const promoteToInbox = (task) => {
  const { bucketId, deadline, priority, ...rest } = task;
  void bucketId; void deadline; void priority;
  return {
    ...rest,
    priority: 0,
    lastModified: new Date().toISOString(),
  };
};

/**
 * Strip bucket membership for scheduling (schedule-to-next-slot on a bucket
 * item): the scheduled copy must not carry bucketId.
 */
export const stripBucketId = (task) => {
  const { bucketId, ...rest } = task;
  void bucketId;
  return rest;
};

/** Normalize a possibly-partial synced config against the defaults. */
export const normalizeBucketConfig = (raw) => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BUCKET_CONFIG };
  return {
    headings: {
      b1: typeof raw.headings?.b1 === 'string' && raw.headings.b1.trim() ? raw.headings.b1 : DEFAULT_BUCKET_CONFIG.headings.b1,
      b2: typeof raw.headings?.b2 === 'string' && raw.headings.b2.trim() ? raw.headings.b2 : DEFAULT_BUCKET_CONFIG.headings.b2,
    },
    secondListHidden: !!raw.secondListHidden,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
  };
};
