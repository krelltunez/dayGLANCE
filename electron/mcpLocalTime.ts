// The block-duration bound of dayGLANCE's write tools (spec §5.3). The generic
// wall-clock rules (isValidWallTime, resolveLocalTime, validateStartTime) live
// in @glance-apps/mcp-host; this one stays because its bounds and its argument
// name, duration_minutes, are dayGLANCE's tool surface.

/** Duration bounds for schedule/resize: a block is 1 minute to 24 hours. */
export function validateDurationMinutes(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return `duration_minutes must be an integer, got ${JSON.stringify(value)}`;
  }
  if (value < 1 || value > 1440) {
    return `duration_minutes must be between 1 and 1440, got ${value}`;
  }
  return null;
}
