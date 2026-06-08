import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSubtitlesFromDb, searchAndStoreMilahuSubtitles, getStoredSubtitle, SubtitleResult } from '../services/subtitles.js';
import { fetchImdbMetadata } from '../services/metadata.js';
import { getCache, setCache } from '../services/cache.js';

export default async function subtitleRoutes(fastify: FastifyInstance) {
  
  const processSubtitles = (subs: SubtitleResult[]) => {
    return subs.map(sub => ({
      language: sub.language,
      format: sub.format,
      filename: sub.filename,
      url: `/subtitles/download/${sub.sha256}`,
      source: sub.source,
      rating: sub.downloads
    }));
  };

  // Show Subtitles
  fastify.get('/subtitles/show/:imdbId/:season/:episode', {
    schema: {
      description: 'Get all available subtitles for a show episode',
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
              filename: { type: 'string' },
              url: { type: 'string' },
              source: { type: 'string' },
              rating: { type: 'number' }
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

    const cacheKey = `subs:show:v2:${imdbId}:${s}:${e}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Check DB first
    let result = await getSubtitlesFromDb(imdbId, 'episode', s, e);

    if (result.length === 0) {
      const meta = await fetchImdbMetadata(imdbId);
      result = await searchAndStoreMilahuSubtitles(imdbId, 'episode', meta.title, s, e);
    }

    if (result.length === 0) {
      return reply.code(404).send({ error: 'Subtitles not found' });
    }

    const response = processSubtitles(result);
    await setCache(cacheKey, response, 24 * 60 * 60);
    return response;
  });

  // Movie Subtitles
  fastify.get('/subtitles/movie/:imdbId', {
    schema: {
      description: 'Get all available subtitles for a movie',
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
              filename: { type: 'string' },
              url: { type: 'string' },
              source: { type: 'string' },
              rating: { type: 'number' }
            }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;

    const cacheKey = `subs:movie:v2:${imdbId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Check DB first
    let result = await getSubtitlesFromDb(imdbId, 'movie');

    if (result.length === 0) {
      const meta = await fetchImdbMetadata(imdbId);
      result = await searchAndStoreMilahuSubtitles(imdbId, 'movie', meta.title);
    }

    if (result.length === 0) {
      return reply.code(404).send({ error: 'Subtitles not found' });
    }

    const response = processSubtitles(result);
    await setCache(cacheKey, response, 24 * 60 * 60);
    return response;
  });

  // Download Route
  fastify.get('/subtitles/download/:sha256', {
    schema: {
      description: 'Download a subtitle file by content hash',
      tags: ['subtitles'],
      params: {
        type: 'object',
        properties: {
          sha256: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { sha256: string } }>, reply: FastifyReply) => {
    const { sha256 } = request.params;
    const buffer = await getStoredSubtitle(sha256);

    if (!buffer) {
      return reply.code(404).send({ error: 'Subtitle file not found' });
    }

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    // We don't have the original filename here easily without a DB lookup, 
    // but the client can set it or we can just return the data.
    return buffer;
  });
}
