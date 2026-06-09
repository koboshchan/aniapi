import axios from 'axios';
import * as cheerio from 'cheerio';

const ANIKOTO_BASE = 'https://anikototv.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0';
const ALLOWED_PROVIDER_HOSTS = ['megaplay.buzz', 'vidwish.live'];

const COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.5',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-GPC': '1',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

export type AnikotoAudioType = 'sub' | 'dub';

export interface AnikotoResolvedId {
  slug: string;
  audioType: AnikotoAudioType;
}

export interface AnikotoStreamResult {
  streamUrl: string;
  subtitleUrl: string | null;
  headers: Record<string, string>;
}

export function parseAnikotoId(input: string): AnikotoResolvedId | null {
  if (!input.startsWith('anikoto:')) return null;

  const parts = input.split(':');
  const slug = parts[1];
  const requestedType = (parts[2] || 'sub').toLowerCase();
  const audioType: AnikotoAudioType = requestedType === 'dub' ? 'dub' : 'sub';

  if (!slug) return null;
  return { slug, audioType };
}

function extractMangaId(html: string): string | null {
  const match = html.match(/const\s+mangaId\s*=\s*(\d+);/);
  return match?.[1] || null;
}

async function fetchWatchHtml(slug: string, episode?: number): Promise<string> {
  const suffix = episode ? `/ep-${episode}` : '';
  const url = `${ANIKOTO_BASE}/watch/${slug}${suffix}`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });
  return res.data;
}

export async function anikotoResolveSeasonSlug(baseSlug: string, season: number): Promise<string> {
  if (season <= 1) return baseSlug;

  try {
    const html = await fetchWatchHtml(baseSlug, 1);
    const mangaId = extractMangaId(html);
    if (!mangaId) return baseSlug;

    const seasonsRes = await axios.get(`${ANIKOTO_BASE}/api/seasons/${mangaId}`, {
      headers: {
        ...COMMON_HEADERS,
        'Referer': `${ANIKOTO_BASE}/watch/${baseSlug}/ep-1`
      },
      timeout: 20000
    });

    if (seasonsRes.data?.result === false || !seasonsRes.data?.result) {
      return baseSlug;
    }

    const $ = cheerio.load(String(seasonsRes.data.result));
    const seasonLinks = $('.swiper-slide.season a')
      .map((_, el) => $(el).attr('href') || '')
      .get()
      .filter(Boolean);

    const target = seasonLinks[season - 1];
    if (!target) return baseSlug;

    const slugMatch = target.match(/\/watch\/([^/?#]+)/);
    return slugMatch?.[1] || baseSlug;
  } catch {
    return baseSlug;
  }
}

function pickEnglishTrack(tracks: any[]): string | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const englishCaption = tracks.find((t) => {
    const label = String(t?.label || '').toLowerCase();
    const kind = String(t?.kind || '').toLowerCase();
    return kind === 'captions' && label.includes('english') && typeof t?.file === 'string';
  });
  if (englishCaption?.file) return englishCaption.file;

  const englishAny = tracks.find((t) => {
    const label = String(t?.label || '').toLowerCase();
    return label.includes('english') && typeof t?.file === 'string';
  });
  if (englishAny?.file) return englishAny.file;

  const first = tracks.find((t) => typeof t?.file === 'string');
  return first?.file || null;
}

function extractPlayerDataId(embedHtml: string): string | null {
  const $ = cheerio.load(embedHtml);

  const direct =
    $('#megaplay-player').attr('data-id') ||
    $('[id="megaplay-player"]').attr('data-id') ||
    $('[data-id][data-realid]').first().attr('data-id');
  if (direct) return direct;

  const titleMatch = embedHtml.match(/<title>\s*File\s+(\d+)\s*-/i);
  if (titleMatch?.[1]) return titleMatch[1];

  return null;
}

function extractProviderOrigin(embedHtml: string, fallbackUrl: string): string {
  const baseUrlMatch = embedHtml.match(/base_url\s*:\s*['"]([^'"]+)['"]/i);
  if (baseUrlMatch?.[1]) {
    try {
      return new URL(baseUrlMatch[1]).origin;
    } catch {
      // fall through to fallback
    }
  }

  try {
    return new URL(fallbackUrl).origin;
  } catch {
    return fallbackUrl;
  }
}

function isAllowedProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_PROVIDER_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export async function anikotoGetEpisodeStream(
  baseSlug: string,
  season: number,
  episode: number,
  audioType: AnikotoAudioType = 'sub'
): Promise<AnikotoStreamResult | null> {
  try {
    const seasonSlug = await anikotoResolveSeasonSlug(baseSlug, season);
    const watchHtml = await fetchWatchHtml(seasonSlug, episode);
    const mangaId = extractMangaId(watchHtml);
    if (!mangaId) return null;

    const referer = `${ANIKOTO_BASE}/watch/${seasonSlug}/ep-${episode}`;

    const epListRes = await axios.get(`${ANIKOTO_BASE}/ajax/episode/list/${mangaId}?vrf=`, {
      headers: {
        ...COMMON_HEADERS,
        'Referer': referer,
        'Alt-Used': 'anikototv.to'
      },
      timeout: 20000
    });

    if (epListRes.data?.status !== 200 || !epListRes.data?.result) return null;

    const $eps = cheerio.load(String(epListRes.data.result));
    const epEl = $eps(`a[data-num="${episode}"]`).first();
    const dataIds = epEl.attr('data-ids');
    if (!dataIds) return null;

    const serverListRes = await axios.get(`${ANIKOTO_BASE}/ajax/server/list?servers=${encodeURIComponent(dataIds)}`, {
      headers: {
        ...COMMON_HEADERS,
        'Referer': referer,
        'Alt-Used': 'anikototv.to'
      },
      timeout: 20000
    });

    if (serverListRes.data?.status !== 200 || !serverListRes.data?.result) return null;

    const $servers = cheerio.load(String(serverListRes.data.result));
    const linkId = $servers(`.servers .type[data-type="${audioType}"] ul li`).first().attr('data-link-id');
    if (!linkId) return null;

    const serverRes = await axios.get(`${ANIKOTO_BASE}/ajax/server?get=${encodeURIComponent(linkId)}`, {
      headers: {
        ...COMMON_HEADERS,
        'Referer': referer,
        'Alt-Used': 'anikototv.to'
      },
      timeout: 20000
    });

    const embedUrlRaw = serverRes.data?.result?.url as string | undefined;
    if (!embedUrlRaw) return null;

    const embedUrl = embedUrlRaw.includes('?') ? `${embedUrlRaw}&autostart=true` : `${embedUrlRaw}?autostart=true`;
    const embedRes = await axios.get(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': `${ANIKOTO_BASE}/`
      },
      timeout: 20000
    });

    const dataId = extractPlayerDataId(embedRes.data);
    if (!dataId) return null;

    const providerOrigin = extractProviderOrigin(embedRes.data, embedUrlRaw);
    const providerHost = new URL(providerOrigin).hostname;
    if (!isAllowedProviderHost(providerHost)) {
      console.warn(`[Anikoto] Unsupported provider host: ${providerHost} (from ${embedUrlRaw})`);
      return null;
    }

    const sourcesRes = await axios.get(`${providerOrigin}/stream/getSources?id=${dataId}&id=${dataId}`, {
      headers: {
        ...COMMON_HEADERS,
        'Referer': embedUrl,
        'Alt-Used': providerHost
      },
      timeout: 20000
    });

    const streamUrl = sourcesRes.data?.sources?.file as string | undefined;
    if (!streamUrl) return null;

    const subtitleUrl = pickEnglishTrack(sourcesRes.data?.tracks || []);

    return {
      streamUrl,
      subtitleUrl,
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': `${providerOrigin}/`
      }
    };
  } catch {
    return null;
  }
}
