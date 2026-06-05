import axios from 'axios';

const VAPLAYER_BASE_URL = 'https://streamdata.vaplayer.ru/api.php';

export interface VaplayerStream {
  stream_urls: string[];
}

export interface VaplayerEps {
  [season: string]: any[] | number;
}

export interface VaplayerResponse {
  data: {
    stream_urls?: string[];
    eps?: VaplayerEps | false;
  };
}

function stripToJSON(s: string): string {
  const p = s.search(/[{[]/);
  return p === -1 ? s : s.slice(p);
}

async function fetchVaplayer(url: string): Promise<any> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
        'Referer': 'https://brightpathsignals.com/',
      },
      timeout: 30000,
      transformResponse: [(data) => data],
    });
    const cleaned = stripToJSON(res.data || '');
    return cleaned ? JSON.parse(cleaned) : null;
  } catch (e: any) {
    console.error(`[Vaplayer] Fetch error for ${url}:`, e.message);
    return null;
  }
}

export async function getVaplayerData(imdbId: string, type: 'movie' | 'tv'): Promise<VaplayerResponse | null> {
  const url = `${VAPLAYER_BASE_URL}?imdb=${imdbId}&type=${type}`;
  return await fetchVaplayer(url);
}

export async function getVaplayerEpisodeStream(imdbId: string, season: number, episode: number): Promise<string | null> {
  const url = `${VAPLAYER_BASE_URL}?imdb=${imdbId}&type=tv&season=${season}&episode=${episode}`;
  const res = await fetchVaplayer(url);
  return res?.data?.stream_urls?.[0] || null;
}

export const supportedTypes = ['movie', 'show'];
