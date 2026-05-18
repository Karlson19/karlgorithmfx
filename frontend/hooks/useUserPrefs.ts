'use client';
import { useEffect, useState } from 'react';
import { UserPrefs, getUserPrefs, setUserPrefs } from '@/lib/userPrefs';

// Hook for components to read+react to user prefs. Subscribes to the
// custom 'userPrefsChange' event so when settings are saved on any
// page/tab, every consumer auto-rerenders.
export function useUserPrefs(): [UserPrefs, (next: Partial<UserPrefs>) => void] {
  const [prefs, setPrefs] = useState<UserPrefs>(getUserPrefs);

  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent<UserPrefs>).detail;
      if (detail) setPrefs(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key && e.key.includes('userPrefs')) setPrefs(getUserPrefs());
    }
    // Also sync on mount in case localStorage changed before subscribe
    setPrefs(getUserPrefs());

    window.addEventListener('userPrefsChange', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('userPrefsChange', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return [prefs, (next) => setUserPrefs(next)];
}
