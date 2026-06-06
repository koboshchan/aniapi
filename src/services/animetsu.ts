import axios from 'axios';

const ANIMETSU_BASE = 'https://animetsu.live';
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
  'Referer': 'https://animetsu.live/'
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
        'Referer': `https://animetsu.live/watch/${animeId}`
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
