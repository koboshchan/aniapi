import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getVaplayerData, getVaplayerEpisodeStream } from '../services/vaplayer.js';
import { fetchImdbMetadata, isShowType } from '../services/metadata.js';
import { animetsuGetStream, animetsuResolveSeasonId } from '../services/animetsu.js';
import { anikotoGetEpisodeStream, parseAnikotoId } from '../services/anikoto.js';
import { miruroGetStream, parseMiruroId } from '../services/miruro.js';
import { storeExternalSubtitleFromUrl } from '../services/subtitles.js';
import { getDb } from '../services/mongodb.js';
import { getCache, setCache } from '../services/cache.js';
import { getImdbIdFromProviderSys } from './info.js';

async function persistSubtitleMetadata(
  imdbId: string,
  mediaType: 'movie' | 'episode',
  sha256: string,
  filename: string,
  format: string,
  season?: number,
  episode?: number
) {
  const db = getDb();
  await db.collection('subtitles').updateOne(
    { sha256, imdbId, type: mediaType, season, episode },
    {
      $set: {
        id: filename,
        language: 'English',
        format,
        filename,
        source: 'anikoto',
        downloads: 0,
        sha256,
        imdbId,
        type: mediaType,
        season,
        episode,
        storedPath: '',
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
}

async function handleMovieDownload(imdbId: string, request: FastifyRequest, reply: FastifyReply) {
  // Check Cache
  const cacheKey = `download:movie:${imdbId}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  // Handle Miruro ID directly (movie treated as episode 1)
  if (imdbId.startsWith('miruro:')) {
    const parsed = parseMiruroId(imdbId);
    if (!parsed) {
      return reply.status(404).send({ error: 'Invalid Miruro ID format' });
    }

    const resolved = await miruroGetStream(parsed.anilistId, 1, parsed.category);
    if (!resolved) {
      return reply.status(404).send({ error: 'No stream found for this Miruro ID' });
    }

    let sub: string | null = null;
    if (resolved.subtitleUrl) {
      const stored = await storeExternalSubtitleFromUrl(resolved.subtitleUrl);
      if (stored?.sha256) {
        sub = `/subtitles/download/${stored.sha256}`;
        await persistSubtitleMetadata(imdbId, 'movie', stored.sha256, stored.filename, stored.format);
      }
    }

    const result = {
      streamUrl: resolved.streamUrl,
      sub,
      headers: resolved.headers
    };
    await setCache(cacheKey, result, 15 * 60);
    return result;
  }

  // Handle Anikoto ID directly (movie treated as episode 1)
  if (imdbId.startsWith('anikoto:')) {
    const parsed = parseAnikotoId(imdbId);
    if (!parsed) {
      return reply.status(404).send({ error: 'Invalid Anikoto ID format' });
    }

    const resolved = await anikotoGetEpisodeStream(parsed.slug, 1, 1, parsed.audioType);
    if (!resolved) {
      return reply.status(404).send({ error: 'No stream found for this Anikoto ID' });
    }

    let sub: string | null = null;
    if (resolved.subtitleUrl) {
      const stored = await storeExternalSubtitleFromUrl(resolved.subtitleUrl);
      if (stored?.sha256) {
        sub = `/subtitles/download/${stored.sha256}`;
        await persistSubtitleMetadata(imdbId, 'movie', stored.sha256, stored.filename, stored.format);
      }
    }

    const result = {
      streamUrl: resolved.streamUrl,
      sub,
      headers: resolved.headers
    };
    await setCache(cacheKey, result, 15 * 60);
    return result;
  }

  // Handle Animetsu ID directly
  if (imdbId.startsWith('animetsu:')) {
    const animetsuId = imdbId.split(':')[1];
    const m3u8 = await animetsuGetStream(animetsuId, 1);
    if (m3u8) {
      const result = {
        streamUrl: m3u8,
        sub: null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Referer': 'https://animetsu.net/'
        }
      };
      await setCache(cacheKey, result, 15 * 60);
      return result;
    }
    return reply.status(404).send({ error: 'No stream found for this Animetsu ID' });
  }
  
  // Fetch metadata to determine media type
  const meta = await fetchImdbMetadata(imdbId);
  const isShow = isShowType(meta.type);
  const vapType = isShow ? 'tv' : 'movie';

  // 1. Try Vaplayer (Primary)
  let vapData = await getVaplayerData(imdbId, vapType);
  let streamUrl = vapData?.data?.stream_urls?.[0];

  if (streamUrl) {
    const result = {
      streamUrl,
      sub: null,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Referer': 'https://nextgencloudfabric.com/',
        'Origin': 'https://nextgencloudfabric.com'
      }
    };
    await setCache(cacheKey, result, 15 * 60);
    return result;
  }

  return reply.status(404).send({ error: 'No stream found for this movie' });
}

async function handleShowDownload(imdbId: string, season: string, episode: string, request: FastifyRequest, reply: FastifyReply) {
  const s = parseInt(season);
  const e = parseInt(episode);

  // Check Cache
  const cacheKey = `download:show:${imdbId}:${season}:${e}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  // Handle Miruro ID directly
  if (imdbId.startsWith('miruro:')) {
    const parsed = parseMiruroId(imdbId);
    if (!parsed) {
      return reply.status(404).send({ error: 'Invalid Miruro ID format' });
    }

    const resolved = await miruroGetStream(parsed.anilistId, e, parsed.category);
    if (!resolved) {
      return reply.status(404).send({ error: 'No stream found for this Miruro ID' });
    }

    let sub: string | null = null;
    if (resolved.subtitleUrl) {
      const stored = await storeExternalSubtitleFromUrl(resolved.subtitleUrl);
      if (stored?.sha256) {
        sub = `/subtitles/download/${stored.sha256}`;
        await persistSubtitleMetadata(imdbId, 'episode', stored.sha256, stored.filename, stored.format, s, e);
      }
    }

    const result = {
      streamUrl: resolved.streamUrl,
      sub,
      headers: resolved.headers
    };
    await setCache(cacheKey, result, 15 * 60);
    return result;
  }

  // Handle Anikoto ID directly
  if (imdbId.startsWith('anikoto:')) {
    const parsed = parseAnikotoId(imdbId);
    if (!parsed) {
      return reply.status(404).send({ error: 'Invalid Anikoto ID format' });
    }

    const resolved = await anikotoGetEpisodeStream(parsed.slug, s, e, parsed.audioType);
    if (!resolved) {
      return reply.status(404).send({ error: 'No stream found for this Anikoto ID' });
    }

    let sub: string | null = null;
    if (resolved.subtitleUrl) {
      const stored = await storeExternalSubtitleFromUrl(resolved.subtitleUrl);
      if (stored?.sha256) {
        sub = `/subtitles/download/${stored.sha256}`;
        await persistSubtitleMetadata(imdbId, 'episode', stored.sha256, stored.filename, stored.format, s, e);
      }
    }

    const result = {
      streamUrl: resolved.streamUrl,
      sub,
      headers: resolved.headers
    };
    await setCache(cacheKey, result, 15 * 60);
    return result;
  }

  // Handle Animetsu ID directly
  if (imdbId.startsWith('animetsu:')) {
    const animetsuId = imdbId.split(':')[1];
    const seasonAnimeId = await animetsuResolveSeasonId(animetsuId, season);
    const m3u8 = await animetsuGetStream(seasonAnimeId, e);
    if (m3u8) {
      const result = {
        streamUrl: m3u8,
        sub: null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Referer': 'https://animetsu.net/'
        }
      };
      await setCache(cacheKey, result, 15 * 60);
      return result;
    }
    return reply.status(404).send({ error: 'No stream found for this Animetsu ID' });
  }

  // 1. Try Vaplayer (Primary)
  let streamUrl = await getVaplayerEpisodeStream(imdbId, s, e);
  
  if (streamUrl) {
    const result = {
      streamUrl,
      sub: null,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Referer': 'https://nextgencloudfabric.com/',
        'Origin': 'https://nextgencloudfabric.com'
      }
    };
    await setCache(cacheKey, result, 15 * 60);
    return result;
  }

  return reply.status(404).send({ error: 'No stream found for this episode' });
}

export default async function downloadRoutes(fastify: FastifyInstance) {
  // GET /download/movie (Query Param based)
  fastify.get('/download/movie', {
    schema: {
      description: 'Get stream URL for a movie by provider, ID, and optional arguments',
      tags: ['download'],
      querystring: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          id: { type: 'string' },
          args: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['provider', 'id']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            streamUrl: { type: 'string' },
            sub: { type: ['string', 'null'] },
            headers: { type: 'object', additionalProperties: { type: 'string' } }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { provider: string, id: string, args?: string | string[] } }>, reply: FastifyReply) => {
    const { provider, id, args } = request.query;
    const imdbId = getImdbIdFromProviderSys(provider, id, args);
    return handleMovieDownload(imdbId, request, reply);
  });

  // GET /download/show (Query Param based)
  fastify.get('/download/show', {
    schema: {
      description: 'Get stream URL for a specific episode by provider, ID, and optional arguments',
      tags: ['download'],
      querystring: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          id: { type: 'string' },
          season: { type: 'string' },
          episode: { type: 'string' },
          args: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['provider', 'id', 'season', 'episode']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            streamUrl: { type: 'string' },
            sub: { type: ['string', 'null'] },
            headers: { type: 'object', additionalProperties: { type: 'string' } }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Querystring: { provider: string, id: string, season: string, episode: string, args?: string | string[] } }>, reply: FastifyReply) => {
    const { provider, id, season, episode, args } = request.query;
    const imdbId = getImdbIdFromProviderSys(provider, id, args);
    return handleShowDownload(imdbId, season, episode, request, reply);
  });

  // GET /download/movie/:imdbId (Legacy route)
  fastify.get('/download/movie/:imdbId', {
    schema: {
      description: 'Get stream URL for a movie by IMDb ID',
      tags: ['download'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567), Animetsu ID (animetsu:id), Anikoto ID (anikoto:id[:sub/dub]), or Miruro ID (miruro:anilistId[:sub/ssub/dub])' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            streamUrl: { type: 'string' },
            sub: { type: ['string', 'null'] },
            headers: { type: 'object', additionalProperties: { type: 'string' } }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;
    return handleMovieDownload(imdbId, request, reply);
  });

  // GET /download/show/:imdbId/:season/:episode (Legacy route)
  fastify.get('/download/show/:imdbId/:season/:episode', {
    schema: {
      description: 'Get stream URL for a specific episode of a show',
      tags: ['download'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567), Animetsu ID (animetsu:id), Anikoto ID (anikoto:id[:sub/dub]), or Miruro ID (miruro:anilistId[:sub/ssub/dub])' },
          season: { type: 'string', description: 'Season number' },
          episode: { type: 'string', description: 'Episode number' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            streamUrl: { type: 'string' },
            sub: { type: ['string', 'null'] },
            headers: { type: 'object', additionalProperties: { type: 'string' } }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string, season: string, episode: string } }>, reply: FastifyReply) => {
    const { imdbId, season, episode } = request.params;
    return handleShowDownload(imdbId, season, episode, request, reply);
  });
}
