import axios from 'axios';
import * as cheerio from 'cheerio';

const PAHE_BASE = 'https://animepahe.ru';

export interface AnimePaheSearchResult {
  title: string;
  session: string;
  type: string;
  episodes: number;
}

export interface AnimePaheEpisode {
  episode: number;
  session: string;
}

async function paheGet(url: string): Promise<any> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': PAHE_BASE + '/',
      },
      timeout: 30000,
      transformResponse: [(data) => data],
    });
    const text = res.data;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (e: any) {
    console.error(`[Pahe] Fetch error for ${url}:`, e.message);
    return null;
  }
}

export async function paheSearch(query: string): Promise<AnimePaheSearchResult[]> {
  const data = await paheGet(`${PAHE_BASE}/api?m=search&q=${encodeURIComponent(query)}`);
  return Array.isArray(data?.data) ? data.data : [];
}

export async function paheGetAllEpisodes(animeSession: string): Promise<AnimePaheEpisode[]> {
  let all: AnimePaheEpisode[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const data = await paheGet(
      `${PAHE_BASE}/api?m=release&id=${animeSession}&sort=episode_asc&page=${page}`
    );
    if (!data?.data) break;
    all = all.concat(data.data);
    lastPage = data.last_page || 1;
    page++;
  } while (page <= lastPage);
  return all;
}

export async function paheExtractLinks(animeSession: string, episodeSession: string) {
  const html = await paheGet(`${PAHE_BASE}/play/${animeSession}/${episodeSession}`);
  if (typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const links: { url: string; quality: string }[] = [];
  $('div#resolutionMenu > button').each((_i, el) => {
    const url = $(el).attr('data-src');
    const quality = $(el).text().trim();
    if (url) links.push({ url, quality });
  });
  return links;
}

/**
 * Unpacks Dean Edwards Packer script
 */
function unpack(code: string): string {
  // Simple implementation of packer unpacking
  // This is a common pattern in AnimePahe
  try {
    const match = /}\((.*)\)\s*$/.exec(code);
    if (!match) return code;
    
    const args = match[1].split(',');
    const p = args[0].replace(/^'|'$/g, '');
    const a = parseInt(args[1]);
    const c = parseInt(args[2]);
    const k = args[3].replace(/^'|'$/g, '').split('|');
    
    const e = (c: number) => {
      return (c < a ? '' : e(Math.floor(c / a))) + 
             ((c % a) > 35 ? String.fromCharCode((c % a) + 29) : (c % a).toString(36));
    };
    
    let result = p;
    for (let i = c - 1; i >= 0; i--) {
      if (k[i]) {
        result = result.replace(new RegExp('\\b' + e(i) + '\\b', 'g'), k[i]);
      }
    }
    return result;
  } catch {
    return code;
  }
}

export async function paheExtractM3U8(videoPageUrl: string): Promise<string | null> {
  const html = await paheGet(videoPageUrl);
  if (typeof html !== 'string') return null;
  const match = /(eval)(\(f.*?)(<\/script>)/s.exec(html);
  if (!match) return null;
  
  // Instead of eval, we use a custom unpacker logic or regex
  // For AnimePahe, the script usually looks like: eval(function(p,a,c,k,e,d){...}(...))
  const code = match[2];
  
  // For safety, we can try to extract the parameters and unpack manually
  // or use a regex if the m3u8 is visible after unpacking.
  // Actually, let's try to extract it from the packed string directly if possible,
  // but unpacking is safer for different formats.
  
  // If we can't easily unpack without eval, we might have to use a safer vm or just the regex if it works.
  // Many times the m3u8 is not directly in the packed string but generated.
  
  // Let's use the regex first, sometimes it's there even if packed (though unlikely)
  let m3u8Match = code.match(/https[^"' ]*\.m3u8[^"' ]*/);
  if (m3u8Match) return m3u8Match[0];

  // If not, we use the unpacker (conceptual)
  // For this exercise, I'll use a regex that matches the parameters of the eval(function(p,a,c,k,e,d))
  const packedMatch = /eval\(function\(p,a,c,k,e,d\)\{.*\}\((.*)\)\)/.exec(code);
  if (packedMatch) {
    const unpacked = unpack(`function(p,a,c,k,e,d){}(${packedMatch[1]})`);
    m3u8Match = unpacked.match(/https[^"' ]*\.m3u8[^"' ]*/);
    if (m3u8Match) return m3u8Match[0];
  }

  return null;
}
