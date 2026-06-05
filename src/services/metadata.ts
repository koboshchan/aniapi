import axios from 'axios';

const IMDB_META_URL = 'https://api.imdbapi.dev/titles';

export interface IMDBMetadata {
  title: string;
  originalTitle: string;
  type: string;
  genres: string[];
  startYear: number | null;
}

export async function fetchImdbMetadata(imdbId: string): Promise<IMDBMetadata> {
  try {
    const res = await axios.get(`${IMDB_META_URL}/${imdbId}`, { timeout: 15000 });
    const d = res.data;
    return {
      title: d.primaryTitle || d.originalTitle || imdbId,
      originalTitle: d.originalTitle || d.primaryTitle || imdbId,
      type: d.type || 'movie',
      genres: d.genres || [],
      startYear: d.startYear || null,
    };
  } catch (e: any) {
    console.error('[Meta] imdbapi.dev lookup failed:', e.message);
    return { 
      title: imdbId, 
      originalTitle: imdbId, 
      type: 'movie', 
      genres: [], 
      startYear: null 
    };
  }
}

export function isShowType(type: string): boolean {
  return /series|mini|episode|special/i.test(type);
}
