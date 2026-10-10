import { createContext, useContext, useState, type ReactNode } from 'react';
const Context = createContext<{
  blocked: boolean;
  setBlocked: (value: boolean) => void;
}>({ blocked: true, setBlocked: () => {} });
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState(true);
  return (
    <Context.Provider value={{ blocked, setBlocked }}>
      {children}
    </Context.Provider>
  );
}
export const useOverlay = () => useContext(Context);
