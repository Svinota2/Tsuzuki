// ============================================================
//  УВЕДОМЛЕНИЯ О НОВЫХ СЕРИЯХ.
//  При запуске смотрим тайтлы из «Смотрю», у которых статус «онгоинг»,
//  и сравниваем число вышедших серий с тем, что записано в библиотеке.
// ============================================================

import { getAiredInfo } from './shikimori.js';
import * as store from '../store.js';
import { toast } from '../utils.js';

let news = [];
let running = false;

export const getNews = () => news;

export function clearNews() {
  news = [];
  window.dispatchEvent(new Event('tsuzuki:news'));
}

export async function checkNewEpisodes() {
  if (running) return;
  running = true;

  try {
    const watching = store
      .listEntries('watching')
      .filter((e) => !e.manual && e.animeStatus === 'ongoing' && Number(e.id) > 0);

    if (!watching.length) return;

    const aired = await getAiredInfo(watching.map((e) => e.id));
    const fresh = [];

    for (const a of aired) {
      const entry = store.getEntry(a.id);
      if (!entry) continue;

      const prev = Number(entry.episodesAired) || 0;
      const next = Number(a.episodesAired) || 0;

      // Если раньше число было неизвестно (0), просто запоминаем его без уведомления.
      if (next > prev && prev > 0) {
        fresh.push({ id: entry.id, title: entry.title, from: prev, to: next });
      }
      if (next !== prev || a.episodes !== entry.episodes || a.nextEpisodeAt !== entry.nextEpisodeAt) {
        store.updateAired(a);
      }
    }

    if (!fresh.length) return;

    news = fresh;
    window.dispatchEvent(new Event('tsuzuki:news'));

    const text = fresh
      .slice(0, 3)
      .map((n) => `${n.title} (+${n.to - n.from})`)
      .join(', ');
    toast(`Новые серии: ${text}${fresh.length > 3 ? ` и ещё ${fresh.length - 3}` : ''}`, 'ok');
  } catch {
    // при запуске сеть может быть недоступна — не мешаем работе
  } finally {
    running = false;
  }
}
