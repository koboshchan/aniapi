import axios from 'axios';

const ANIMETSU_BASE = 'https://animetsu.net';
const PROXY_BASE = 'https://swiftstream.top/proxy';

export interface AnimetsuSearchResult {
  id: string;
  title: {
    romaji: string;
    english: string;
    native: string;
  };
  total_eps: number;
  year: number;
}

export interface AnimetsuInfoSeason {
  id: string;
  total_eps?: number;
  relation?: string;
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  year?: number;
}

export interface AnimetsuInfo {
  id: string;
  total_eps: number;
  year: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  genres?: string[];
  seasons?: AnimetsuInfoSeason[];
}

export interface AnimetsuSource {
  url: string;
  quality: string;
  type: string;
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
  'sec-ch-ua-arch': '"arm"',
  'sec-ch-ua-bitness': '"64"',
  'sec-ch-ua-full-version': '"146.0.7821.31"',
  'sec-ch-ua-full-version-list': '"Not-A.Brand";v="24.0.0.0", "Chromium";v="146.0.7821.31"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-platform': '"macOS"',
  'sec-ch-ua-platform-version': '"26.1.0"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'Referer': 'https://animetsu.net/'
};

export async function animetsuSearch(query: string): Promise<AnimetsuSearchResult[]> {
  // Try with full query first, then variations
  const cleanQueries = (q: string) => {
    const list = [q];
    // If it has "The Movie", try just "Movie"
    if (q.toLowerCase().includes('the movie')) {
      list.push(q.replace(/the movie/i, 'Movie').trim());
      list.push(q.replace(/the movie/i, '').trim());
    }
    // Remove colons and special chars for more variations
    list.push(q.replace(/[:!]/g, '').trim());
    return [...new Set(list)];
  };

  const queriesToTry = cleanQueries(query);
  
  for (const q of queriesToTry) {
    try {
      const res = await axios.get(`${ANIMETSU_BASE}/v2/api/anime/search/`, {
        params: { query: q },
        headers: COMMON_HEADERS,
        timeout: 15000
      });
      const results = res.data?.results || [];
      if (results.length > 0) return results;
    } catch (e: any) {
      continue;
    }
  }
  
  return [];
}

export async function animetsuGetInfo(animeId: string): Promise<AnimetsuInfo | null> {
  try {
    const res = await axios.get(`${ANIMETSU_BASE}/v2/api/anime/info/${animeId}`, {
      headers: COMMON_HEADERS,
      timeout: 15000
    });
    return res.data || null;
  } catch (e: any) {
    console.error(`[Animetsu] GetInfo error for ${animeId}:`, e.message);
    return null;
  }
}

function parseSeasonNumber(relation?: string): number | null {
  if (!relation) return null;
  const m = relation.match(/season\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function getAnimetsuSeasonEpisodes(info: AnimetsuInfo): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (Array.isArray(info.seasons) && info.seasons.length > 0) {
    const usedKeys = new Set<string>();
    for (let i = 0; i < info.seasons.length; i++) {
      const s = info.seasons[i];
      const parsed = parseSeasonNumber(s.relation);
      const key = String(parsed ?? i + 1);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);

      const eps = Math.max(1, Number(s.total_eps || 0));
      result[key] = Array.from({ length: eps }, (_, idx) => String(idx + 1));
    }
  }

  if (Object.keys(result).length === 0 && info.total_eps > 0) {
    result['1'] = Array.from({ length: info.total_eps }, (_, i) => String(i + 1));
  }

  return result;
}

export async function animetsuResolveSeasonId(animeId: string, season: number): Promise<string> {
  const info = await animetsuGetInfo(animeId);
  if (!info || !Array.isArray(info.seasons) || info.seasons.length === 0) {
    return animeId;
  }

  const byRelation = info.seasons.find(s => parseSeasonNumber(s.relation) === season);
  if (byRelation?.id) return byRelation.id;

  const byIndex = info.seasons[season - 1];
  if (byIndex?.id) return byIndex.id;

  return animeId;
}

export function findBestAnimetsuMatch(results: AnimetsuSearchResult[], title: string, year?: number | null): AnimetsuSearchResult | null {
  if (!results.length) return null;

  const cleanTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = cleanTitle(title);

  // 1. Try to find an exact match in title or romaji
  for (const r of results) {
    const rTitle = cleanTitle(r.title.english || '');
    const rRomaji = cleanTitle(r.title.romaji || '');
    
    const titleMatch = rTitle === target || rRomaji === target;
    const yearMatch = year ? r.year === year : true;

    if (titleMatch && yearMatch) return r;
  }

  // 2. Try to find a partial match with year validation
  for (const r of results) {
    const rTitle = cleanTitle(r.title.english || '');
    const rRomaji = cleanTitle(r.title.romaji || '');
    
    const partialMatch = rTitle.includes(target) || rRomaji.includes(target) || target.includes(rTitle) || target.includes(rRomaji);
    const yearMatch = year ? r.year === year : false; // For partial match, require year if provided

    if (partialMatch && yearMatch) return r;
  }

  // 3. Fallback to first result if it seems related
  const first = results[0];
  const firstTitle = cleanTitle(first.title.english || '');
  const firstRomaji = cleanTitle(first.title.romaji || '');
  if (firstTitle.includes(target.slice(0, 5)) || firstRomaji.includes(target.slice(0, 5))) {
     return first;
  }

  return null;
}

export async function animetsuGetStream(animeId: string, epNum: number): Promise<string | null> {
  try {
    const url = `${ANIMETSU_BASE}/v2/api/anime/oppai/${animeId}/${epNum}?server=default&source_type=sub`;
    const res = await axios.get(url, {
      headers: {
        ...COMMON_HEADERS,
        'Referer': `https://animetsu.net/watch/${animeId}`
      },
      timeout: 15000
    });

    const source = res.data?.sources?.[0];
    if (source?.url) {
      return `${PROXY_BASE}${source.url}`;
    }
    return null;
  } catch (e: any) {
    return null;
  }
}

export const supportedTypes = ['movie', 'show'];
