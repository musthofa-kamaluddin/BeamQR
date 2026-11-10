import { useEffect, useRef, useState } from 'react';

export function useWakeLock(active: boolean): boolean {
  const [locked, setLocked] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) {
      setLocked(false);
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setLocked(true);
        sentinel.addEventListener('release', () => {
          if (!cancelled) setLocked(false);
        });
      } catch {
        if (!cancelled) setLocked(false);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && active && !sentinelRef.current) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      const current = sentinelRef.current;
      sentinelRef.current = null;
      if (current) {
        void current.release().catch(() => {});
      }
      setLocked(false);
    };
  }, [active]);

  return locked;
}
