// Акцентный цвет, выбранный в «Настройках», перекрывает тот, что в styles/theme.css
import { getPrefs } from './store.js';

// Цвета, которые предлагаются в настройках. Добавляй свои.
export const ACCENTS = ['#ff5d48', '#ff3d7f', '#a78bfa', '#60a5fa', '#22d3ee', '#4ade80', '#fbbf24'];

export function applyAccent() {
  const accent = getPrefs().accent;
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  else document.documentElement.style.removeProperty('--accent');
}
