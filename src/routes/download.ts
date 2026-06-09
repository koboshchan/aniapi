import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getVaplayerData, getVaplayerEpisodeStream } from '../services/vaplayer.js';
import { fetchImdbMetadata, isShowType } from '../services/metadata.js';
import { animetsuGetStream, animetsuResolveSeasonId } from '../services/animetsu.js';
import { getCache, setCache } from '../services/cache.js';

export default async function downloadRoutes(fastify: FastifyInstance) {
  
  // Movie download
  fastify.get('/download/movie/:imdbId', {
    schema: {
      description: 'Get stream URL for a movie by IMDb ID',
      tags: ['download'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567) or Animetsu ID (e.g. animetsu:id)' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            streamUrl: { type: 'string' },
            headers: { type: 'object', additionalProperties: { type: 'string' } }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;

    // Check Cache
    const cacheKey = `download:movie:${imdbId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Handle Animetsu ID directly
    if (imdbId.startsWith('animetsu:')) {
      const animetsuId = imdbId.split(':')[1];
      const m3u8 = await animetsuGetStream(animetsuId, 1);
      if (m3u8) {
        const result = {
          streamUrl: m3u8,
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
  });

  // Show download
  fastify.get('/download/show/:imdbId/:season/:episode', {
    schema: {
      description: 'Get stream URL for a specific episode of a show',
      tags: ['download'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567) or Animetsu ID (e.g. animetsu:id)' },
          season: { type: 'string', description: 'Season number' },
          episode: { type: 'string', description: 'Episode number' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            streamUrl: { type: 'string' },
            headers: { type: 'object', additionalProperties: { type: 'string' } }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string, season: string, episode: string } }>, reply: FastifyReply) => {
    const { imdbId, season, episode } = request.params;
    const s = parseInt(season);
    const e = parseInt(episode);

    // Check Cache
    const cacheKey = `download:show:${imdbId}:${s}:${e}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Handle Animetsu ID directly
    if (imdbId.startsWith('animetsu:')) {
      const animetsuId = imdbId.split(':')[1];
      const seasonAnimeId = await animetsuResolveSeasonId(animetsuId, s);
      const m3u8 = await animetsuGetStream(seasonAnimeId, e);
      if (m3u8) {
        const result = {
          streamUrl: m3u8,
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
  });
}
