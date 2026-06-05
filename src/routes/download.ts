import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getVaplayerData, getVaplayerEpisodeStream } from '../services/vaplayer.js';
import { fetchImdbMetadata } from '../services/metadata.js';
import { animetsuSearch, animetsuGetStream } from '../services/animetsu.js';
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
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567)' }
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
    
    // Try Vaplayer first
    let vapData = await getVaplayerData(imdbId, 'movie');
    let streamUrl = vapData?.data?.stream_urls?.[0];
    
    // Fallback check (some movies are in movie endpoint, some in tv endpoint with eps:false)
    if (!streamUrl && vapData?.data?.eps === false) {
      vapData = await getVaplayerData(imdbId, 'movie');
      streamUrl = vapData?.data?.stream_urls?.[0];
    }

    if (streamUrl) {
      const result = {
        streamUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Referer': 'https://brightpathsignals.com/'
        }
      };
      await setCache(cacheKey, result, 15 * 60);
      return result;
    }

    // 2. Fallback to Animetsu
    console.log(`[Fallback] Vaplayer failed for movie ${imdbId}, trying Animetsu...`);
    const meta = await fetchImdbMetadata(imdbId);
    
    // Sanitize title for movie search
    const query = meta.title.split(/[:\-]/)[0].trim();
    const results = await animetsuSearch(query);
    
    if (results.length > 0) {
      const m3u8 = await animetsuGetStream(results[0].id, 1);
      if (m3u8) {
        const result = {
          streamUrl: m3u8,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
            'Referer': 'https://animetsu.live/'
          }
        };
        await setCache(cacheKey, result, 15 * 60);
        return result;
      }
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
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567)' },
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

    // 1. Try Vaplayer
    let streamUrl = await getVaplayerEpisodeStream(imdbId, s, e);
    
    if (streamUrl) {
      const result = {
        streamUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Referer': 'https://brightpathsignals.com/'
        }
      };
      await setCache(cacheKey, result, 15 * 60);
      return result;
    }

    // 2. Fallback to Animetsu
    console.log(`[Fallback] Vaplayer failed for ${imdbId} S${s}E${e}, trying Animetsu...`);
    const meta = await fetchImdbMetadata(imdbId);
    
    // Simple search queries based on title
    const queries = s > 1 
      ? [`${meta.title} Season ${s}`, `${meta.title} ${s}nd Season`, meta.title]
      : [meta.title];
    
    let animetsuId = null;
    for (const q of queries) {
      const results = await animetsuSearch(q);
      if (results.length > 0) {
        animetsuId = results[0].id;
        break;
      }
    }

    if (animetsuId) {
      const m3u8 = await animetsuGetStream(animetsuId, e);
      if (m3u8) {
        const result = {
          streamUrl: m3u8,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
            'Referer': 'https://animetsu.live/'
          }
        };
        await setCache(cacheKey, result, 15 * 60);
        return result;
      }
    }

    return reply.status(404).send({ error: 'No stream found for this episode' });
  });
}
