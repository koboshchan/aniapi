import axios from 'axios';
import * as zlib from 'zlib';

const MIRURO_BASE = 'https://www.miruro.tv';
const PIPE_OBF_KEY = '71951034f8fbcf53d89db52ceb3dc22c';

interface RoutePayload {
  path: string;
  method: 'GET';
  query: Record<string, string>;
  body: null;
  version: string;
}

async function pipeGet(path: string, query: Record<string, string>): Promise<any> {
  const payload: RoutePayload = { path, method: 'GET', query, body: null, version: '0.2.0' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const response = await axios.get(`${MIRURO_BASE}/api/secure/pipe?e=${b64}`, {
    headers: {
      Host: 'www.miruro.tv',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Referer: `${MIRURO_BASE}/`,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
      'sec-ch-ua-platform': '"macOS"',
    },
    responseType: 'text',
    decompress: true,
    timeout: 30000,
  });

  const obfuscated = response.headers['x-obfuscated'] === '2';
  const standardB64 = response.data.replace(/-/g, '+').replace(/_/g, '/');
  let buffer = Buffer.from(standardB64, 'base64');

  if (obfuscated) {
    const keyBuf = Buffer.from(PIPE_OBF_KEY, 'hex');
    const decrypted = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      decrypted[i] = buffer[i] ^ keyBuf[i % keyBuf.length];
    }
    buffer = decrypted;
  }

  return JSON.parse(zlib.gunzipSync(buffer).toString('utf-8'));
}

export type MiruroCategory = 'sub' | 'ssub' | 'dub';

export interface MiruroResolvedId {
  anilistId: string;
  category: MiruroCategory;
}

export interface MiruroEpisode {
  id: string;
  number: number;
  title: string;
}

export interface MiruroStreamResult {
  streamUrl: string;
  subtitleUrl: string | null;
  headers: Record<string, string>;
}

export interface MiruroInfo {
  title: string;
  originalTitle: string;
  genres: string[];
  episodes: Record<string, string[]>; // season -> [ep1, ep2, ep3]
}

/**
 * Parse a miruro: ID string like "miruro:21355:ssub"
 */
export function parseMiruroId(input: string): MiruroResolvedId | null {
  if (!input.startsWith('miruro:')) return null;
  const parts = input.split(':');
  const anilistId = parts[1];
  const cat = (parts[2] || 'sub').toLowerCase();
  const validCategories: MiruroCategory[] = ['sub', 'ssub', 'dub'];
  const category: MiruroCategory = validCategories.includes(cat as MiruroCategory)
    ? (cat as MiruroCategory)
    : 'sub';

  if (!anilistId || !/^\d+$/.test(anilistId)) return null;
  return { anilistId, category };
}

export async function miruroGetInfo(anilistId: string, category: MiruroCategory): Promise<MiruroInfo> {
  const epData = await pipeGet('episodes', { anilistId });
  const providers = epData?.providers || {};
  const audio: 'sub' | 'dub' = category === 'dub' ? 'dub' : 'sub';

  const epNumbers = new Set<string>();

  for (const provData of Object.values(providers) as any[]) {
    const eps = provData?.episodes?.[audio] as MiruroEpisode[] | undefined;
    if (eps) {
      for (const e of eps) {
        epNumbers.add(String(e.number));
      }
    }
  }

  // Fallback to sub if dub requested but no dub episodes found
  if (epNumbers.size === 0 && audio === 'dub') {
    for (const provData of Object.values(providers) as any[]) {
      const eps = provData?.episodes?.sub as MiruroEpisode[] | undefined;
      if (eps) {
        for (const e of eps) {
          epNumbers.add(String(e.number));
        }
      }
    }
  }

  // Sort episodes numerically
  const sortedEps = Array.from(epNumbers).sort((a, b) => parseInt(a) - parseInt(b));

  // Try to get a better title from metadata providers
  let title = '';
  const metaProviders = ['ANIMEDUNYA', 'ANIMEONSEN', 'SENSHI', 'CRUNCHYROLL', 'ANIMEKAI', 'KUUDERE'];
  for (const mp of metaProviders) {
    const meta = providers[mp]?.meta;
    if (meta?.title) {
      title = meta.title;
      break;
    }
  }

  return {
    title: title || `AniList ${anilistId}`,
    originalTitle: title || '',
    genres: [],
    episodes: sortedEps.length > 0 ? { "1": sortedEps } : {},
  };
}

async function fetchSources(
  episodesData: any,
  episode: number,
  category: MiruroCategory,
  anilistId: string
): Promise<{ streamUrl: string | null; subtitles: any[] }> {
  const srcCategory = category === 'dub' ? 'dub' : category === 'ssub' ? 'ssub' : 'sub';
  const audio: 'sub' | 'dub' = category === 'dub' ? 'dub' : 'sub';
  const providers = episodesData?.providers || {};

  // Build a list of (providerName, episodeId) pairs in priority order
  const candidates: { prov: string; epId: string }[] = [];
  const seen = new Set<string>();
  for (const provName of [...Object.keys(providers), 'bonk', 'bee', 'hop', 'kiwi']) {
    if (seen.has(provName)) continue;
    seen.add(provName);
    const eps = providers[provName]?.episodes?.[audio] as MiruroEpisode[] | undefined;
    if (!eps) continue;
    const match = eps.find(e => e.number === episode);
    if (match) {
      candidates.push({ prov: provName, epId: match.id });
    }
  }

  // Dub fallback: also check sub episodes from providers
  if (candidates.length === 0 && audio === 'dub') {
    for (const provName of Object.keys(providers)) {
      const eps = providers[provName]?.episodes?.sub as MiruroEpisode[] | undefined;
      if (!eps) continue;
      const match = eps.find(e => e.number === episode);
      if (match) {
        candidates.push({ prov: provName, epId: match.id });
      }
    }
  }

  for (const { prov, epId } of candidates) {
    try {
      const src = await pipeGet('sources', {
        episodeId: epId,
        provider: prov,
        category: srcCategory,
        anilistId,
      });
      const hls = (src.streams || []).find((s: any) => s.type === 'hls');
      if (hls?.url) {
        return { streamUrl: hls.url, subtitles: src.subtitles || [] };
      }
    } catch (e: any) {
      if (e.message?.includes('444')) continue;
      throw e;
    }
  }

  return { streamUrl: null, subtitles: [] };
}

export async function miruroGetStream(
  anilistId: string,
  episode: number,
  category: MiruroCategory
): Promise<MiruroStreamResult | null> {
  try {
    const episodesData = await pipeGet('episodes', { anilistId });
    const { streamUrl, subtitles } = await fetchSources(episodesData, episode, category, anilistId);

    if (!streamUrl) return null;

    const englishTrack = subtitles.find((s: any) => {
      const label = String(s?.label || '').toLowerCase();
      return label.includes('english') && typeof s?.file === 'string';
    });

    return {
      streamUrl,
      subtitleUrl: englishTrack?.file || null,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Referer: MIRURO_BASE + '/',
      },
    };
  } catch (e: any) {
    console.error(`[Miruro] Stream error for ${anilistId}:E${episode}:${category}:`, e.message);
    return null;
  }
}
