// Preserve unrelated additions/edits queued while an async request was outstanding.
export function applyPlannedList(current, snapshot = [], planned) {
  if (current === snapshot) return planned;
  const before = new Map(snapshot.map(task => [String(task.id), task]));
  const after = new Map(planned.map(task => [String(task.id), task]));
  const present = new Set(current.map(task => String(task.id)));
  const merged = current.flatMap(task => {
    const id = String(task.id);
    if (!before.has(id) || task !== before.get(id)) return [task];
    return after.has(id) ? [after.get(id)] : [];
  });
  for (const task of planned) if (!present.has(String(task.id)) && !before.has(String(task.id))) merged.push(task);
  return merged;
}
