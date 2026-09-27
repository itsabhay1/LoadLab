import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

export function useServiceStatus() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true, health: null, ready: null, checkedAt: null });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      // The microtask also makes initial loading updates safe with StrictMode effect cleanup.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setState((previous) => ({ ...previous, loading: true }));
      const [health, ready] = await Promise.allSettled([
        api.health({ signal: controller.signal }),
        api.ready({ signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setState({ loading: false, health, ready, checkedAt: new Date() });
      timer = setTimeout(poll, 15000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  return { ...state, refresh };
}
