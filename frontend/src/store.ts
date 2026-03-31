import { create } from 'zustand';

interface AppState {
  selectedTables: string[];
  addTable: (fullName: string) => void;
  removeTable: (fullName: string) => void;
  clearTables: () => void;
  toggleTable: (fullName: string) => void;
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
}));
