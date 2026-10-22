// Whether the server has the public seven-day trial switched on (GET /api/auth/trial/status). False until it answers,
// and false on any failure, so nothing on screen ever promises a sign-up that would be refused.
import { useEffect, useState } from 'react';

export function useTrialAvailable(enabled = true): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch('/api/auth/trial/status', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (active) setOn(v?.available === true); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [enabled]);
  return on;
}
