import { create } from 'zustand';

interface AppState {
  selectedTables: string[];
  addTable: (fullName: string) => void;
  removeTable: (fullName: string) => void;
  clearTables: () => void;
  toggleTable: (fullName: string) => void;
  addTables: (fullNames: string[]) => void;
  removeTables: (fullNames: string[]) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  selectedTables: [],
  addTable: (fullName) =>
    set((s) => ({
      selectedTables: s.selectedTables.includes(fullName)
        ? s.selectedTables
        : [...s.selectedTables, fullName],
    })),
  removeTable: (fullName) =>
    set((s) => ({
      selectedTables: s.selectedTables.filter((t) => t !== fullName),
    })),
  clearTables: () => set({ selectedTables: [] }),
  toggleTable: (fullName) => {
    const { selectedTables } = get();
    if (selectedTables.includes(fullName)) {
      set({ selectedTables: selectedTables.filter((t) => t !== fullName) });
    } else {
      set({ selectedTables: [...selectedTables, fullName] });
    }
  },
  addTables: (fullNames) =>
    set((s) => {
      const existing = new Set(s.selectedTables);
      const additions = fullNames.filter((n) => !existing.has(n));
      return additions.length
        ? { selectedTables: [...s.selectedTables, ...additions] }
        : s;
    }),
  removeTables: (fullNames) =>
    set((s) => {
      const drop = new Set(fullNames);
      return { selectedTables: s.selectedTables.filter((t) => !drop.has(t)) };
    }),
}));
