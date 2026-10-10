import { useEffect, useRef, useState } from 'react';
import { createFocusSession } from '../jobo/focusSession.js';

export default function useFocusDo(state) {
  const latest = useRef(state);
  latest.current = state;
  const [review, setReview] = useState(null);
  const session = useRef(null);
  if (!session.current) session.current = createFocusSession({ getState: () => latest.current, publish: setReview });
  useEffect(() => { if (!state.enabled) session.current.disable(); }, [state.enabled]);
  return { ...session.current, review };
}
