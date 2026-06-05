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
  // Sanitize query: keep the part after the colon but stop at the first punctuation like , or .
  let sanitizedQuery = query;
  const colonIndex = query.indexOf(':');
  if (colonIndex !== -1) {
    const before = query.slice(0, colonIndex);
    const after = query.slice(colonIndex + 1);
    const firstPartAfter = after.split(/[.,]/)[0];
    sanitizedQuery = `${before}:${firstPartAfter}`;
  }
  sanitizedQuery = sanitizedQuery.trim();
  
  try {
    const res = await axios.get(`${ANIMETSU_BASE}/v2/api/anime/search/`, {
      params: { query: sanitizedQuery },
      headers: COMMON_HEADERS,
      timeout: 15000
    });
    return res.data?.results || [];
  } catch (e: any) {
    return [];
  }
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
