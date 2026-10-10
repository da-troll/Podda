import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api';
import type { Preferences } from '../types';
export const DEFAULT_PREFERENCES: Preferences = {
  channelSort: 'newest',
  channelHideCompleted: false,
};
const Context = createContext<{
  preferences: Preferences;
  loading: boolean;
  error: string;
  save: (value: Preferences) => Promise<void>;
} | null>(null);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api
      .getPreferences()
      .then((value) => {
        if (live) setPreferences(value);
      })
      .catch(() => {
        if (live) setError('Could not load preferences. Using defaults.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const save = async (value: Preferences) => {
    const saved = await api.savePreferences(value);
    setPreferences(saved);
    setError('');
  };
  return (
    <Context.Provider value={{ preferences, loading, error, save }}>
      {children}
    </Context.Provider>
  );
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider required');
  return value;
}
