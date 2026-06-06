import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { searchFeliratok, searchOpenSubtitlesLegacy, getFeliratokDownload, getOpenSubtitlesDownload, SubtitleResult } from '../services/subtitles.js';
import { fetchImdbMetadata } from '../services/metadata.js';
import { getCache, setCache } from '../services/cache.js';

export default async function subtitleRoutes(fastify: FastifyInstance) {
  
  // Show Subtitles
  fastify.get('/subtitles/show/:imdbId/:season/:episode', {
    schema: {
      description: 'Get available subtitles for a show episode (via Feliratok.eu)',
      tags: ['subtitles'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string' },
          season: { type: 'string' },
          episode: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              language: { type: 'string' },
              format: { type: 'string' },
              url: { type: 'string' },
              source: { type: 'string' }
            }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string, season: string, episode: string } }>, reply: FastifyReply) => {
    const { imdbId, season, episode } = request.params;
    const s = parseInt(season);
    const e = parseInt(episode);

    const cacheKey = `subs:show:${imdbId}:${s}:${e}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Get metadata for title-based search
    const meta = await fetchImdbMetadata(imdbId);
    
    // 1. Try Feliratok
    let result = await searchFeliratok(meta.title, s, e);
    
    // 2. Try OpenSubtitles as fallback
    if (result.length === 0) {
      result = await searchOpenSubtitlesLegacy(imdbId);
    }

    const response = result.map(sub => ({
      language: sub.language,
      format: sub.format,
      url: `/subtitles/download/${sub.source}/${sub.id}?${sub.source === 'opensubtitles' ? `link=${encodeURIComponent((sub as any).downloadLink)}&` : ''}ep=${e}`,
      source: sub.source,
      downloads: sub.downloads
    }));

    if (response.length === 0) {
      return reply.code(404).send({ error: 'Subtitles not found' });
    }

    // Only return the one with the most downloads
    const bestResult = [response[0]];

    await setCache(cacheKey, bestResult, 48 * 60 * 60); // 48 hours
    return bestResult;
  });

  // Movie Subtitles
  fastify.get('/subtitles/movie/:imdbId', {
    schema: {
      description: 'Get available subtitles for a movie (via OpenSubtitles)',
      tags: ['subtitles'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              language: { type: 'string' },
              format: { type: 'string' },
              url: { type: 'string' },
              source: { type: 'string' }
            }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;

    const cacheKey = `subs:movie:${imdbId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Get metadata for title-based search (required for Feliratok)
    const meta = await fetchImdbMetadata(imdbId);

    // 1. Try Feliratok first (consistent with shows)
    let result = await searchFeliratok(meta.title, 0, 0);
    
    // 2. Try OpenSubtitles as primary/fallback for movies
    const osResults = await searchOpenSubtitlesLegacy(imdbId);
    
    // Combine and sort by downloads
    const combined: SubtitleResult[] = [...result, ...osResults].sort((a, b) => b.downloads - a.downloads);
    
    const response = combined.map(sub => ({
      language: sub.language,
      format: sub.format,
      url: `/subtitles/download/${sub.source}/${sub.id}${sub.source === 'opensubtitles' ? `?link=${encodeURIComponent((sub as any).downloadLink)}` : ''}`,
      source: sub.source,
      downloads: sub.downloads
    }));

    if (response.length === 0) {
      return reply.code(404).send({ error: 'Subtitles not found' });
    }

    // Only return the one with the most downloads
    const bestResult = [response[0]];

    await setCache(cacheKey, bestResult, 48 * 60 * 60); // 48 hours
    return bestResult;
  });

  // Download Proxy
  fastify.get('/subtitles/download/:source/:id', {
    schema: {
      description: 'Download a subtitle file (proxied)',
      tags: ['subtitles'],
      params: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['feliratok', 'opensubtitles'] },
          id: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          link: { type: 'string' },
          ep: { type: 'string' }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { source: string, id: string }, Querystring: { link?: string, ep?: string } }>, reply: FastifyReply) => {
    const { source, id } = request.params;
    const { link, ep } = request.query;
    
    let buffer: Buffer | null = null;
    
    if (source === 'feliratok') {
      buffer = await getFeliratokDownload(id, ep ? parseInt(ep) : undefined);
    } else if (source === 'opensubtitles' && link) {
      buffer = await getOpenSubtitlesDownload(link);
    }

    if (!buffer) {
      return reply.code(404).send({ error: 'Subtitle file not found' });
    }

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="subtitle-${id}.srt"`);
    return reply.send(buffer);
  });
}
