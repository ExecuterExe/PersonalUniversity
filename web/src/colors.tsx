// У каждой дисциплины свой цвет — один и тот же на всех экранах.
import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useApi } from './hooks';
import type { Discipline } from './types';

export interface DisciplineColor {
  accent: string;
  soft: string;
}

// Порядок подобран валидатором: соседние цвета различимы и при нарушениях цветового зрения.
// Рядом с цветом всегда стоит название дисциплины — цвет не единственный признак.
const PALETTE: DisciplineColor[] = [
  { accent: '#5468ee', soft: '#eceffe' },
  { accent: '#eb6834', soft: '#fdeee6' },
  { accent: '#1baf7a', soft: '#e3f6ee' },
  { accent: '#e0a000', soft: '#fdf4dc' },
  { accent: '#e07aa8', soft: '#fcedf4' },
  { accent: '#13863f', soft: '#e3f3e8' },
  { accent: '#7b5ce8', soft: '#f1edfd' },
  { accent: '#e34948', soft: '#fdeaea' },
];

const ColorsContext = createContext<Map<string, DisciplineColor>>(new Map());

/** Цвет — по порядку создания дисциплин, включая архивные: так он не «прыгает». */
export function ColorsProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<Discipline[]>('/api/disciplines?archived=true');
  const colors = useMemo(() => {
    const map = new Map<string, DisciplineColor>();
    [...(data ?? [])]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .forEach((d, i) => map.set(d.id, PALETTE[i % PALETTE.length]!));
    return map;
  }, [data]);
  return <ColorsContext.Provider value={colors}>{children}</ColorsContext.Provider>;
}

/** Цвета сразу для многих дисциплин — например, для сегментов графика. */
export function useColors(): (disciplineId: string) => DisciplineColor {
  const map = useContext(ColorsContext);
  return (disciplineId) => map.get(disciplineId) ?? PALETTE[0]!;
}

export function useColor(disciplineId: string): DisciplineColor {
  return useContext(ColorsContext).get(disciplineId) ?? PALETTE[0]!;
}

/** CSS-переменные --accent и --accent-soft для полос, блоков и карточек. */
export function accent(color: DisciplineColor): CSSProperties {
  return { '--accent': color.accent, '--accent-soft': color.soft } as CSSProperties;
}

export function useAccent(disciplineId: string): CSSProperties {
  return accent(useColor(disciplineId));
}
