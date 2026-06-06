import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fetchImdbMetadata, isShowType } from '../services/metadata.js';
import { getVaplayerData } from '../services/vaplayer.js';
import { animetsuSearch, findBestAnimetsuMatch } from '../services/animetsu.js';
import { getCache, setCache } from '../services/cache.js';

export default async function infoRoutes(fastify: FastifyInstance) {
  fastify.get('/info/:imdbId', {
    schema: {
      description: 'Get metadata and stream/episode info for a movie or show by IMDb ID',
      tags: ['metadata'],
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
            imdbId: { type: 'string' },
            title: { type: 'string' },
            originalTitle: { type: 'string' },
            type: { type: 'string' },
            mediaType: { type: 'string' },
            genres: { type: 'array', items: { type: 'string' } },
            year: { type: 'number', nullable: true },
            episodes: { type: 'object', additionalProperties: true, nullable: true },
            hasPrimaryStream: { type: 'boolean' }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;
    
    // Check Cache
    const cacheKey = `info:${imdbId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const meta = await fetchImdbMetadata(imdbId);
    const isShow = isShowType(meta.type);
    const mediaType = isShow ? 'show' : 'movie';
    
    let episodes: any = null;
    let stream_urls: string[] = [];

    // Try Vaplayer first, checking both endpoints if needed
    if (!isShow) {
      // Movie path: try movie endpoint then tv
      let vapData = await getVaplayerData(imdbId, 'movie');
      stream_urls = vapData?.data?.stream_urls || [];
      if (stream_urls.length === 0) {
        vapData = await getVaplayerData(imdbId, 'tv');
        stream_urls = vapData?.data?.stream_urls || [];
      }
    } else {
      // Show path: try tv endpoint then movie (just in case)
      let vapData = await getVaplayerData(imdbId, 'tv');
      episodes = vapData?.data?.eps || null;
      if (!episodes) {
        vapData = await getVaplayerData(imdbId, 'movie');
        episodes = vapData?.data?.eps || null;
      }

      // Fallback to Animetsu if Vaplayer has no episodes
      if (!episodes) {
        console.log(`[Info Fallback] Vaplayer has no episodes for ${imdbId}, checking Animetsu...`);
        const searchResults = await animetsuSearch(meta.title);
        const match = findBestAnimetsuMatch(searchResults, meta.title, meta.startYear);
        
        if (match) {
          // Generate an array of strings ["1", "2", ..., "N"] to match Vaplayer's format
          const epArray = Array.from({ length: match.total_eps }, (_, i) => (i + 1).toString());
          episodes = { "1": epArray };
          console.log(`[Info Fallback] Found on Animetsu: ${match.title.english || match.title.romaji} (${match.total_eps} eps)`);
        }
      }
    }

    const result = {
      imdbId,
      title: meta.title,
      originalTitle: meta.originalTitle,
      type: mediaType,
      mediaType: mediaType,
      genres: meta.genres,
      year: meta.startYear,
      episodes: episodes,
      hasPrimaryStream: !isShow ? stream_urls.length > 0 : episodes !== null
    };

    // Cache for 48 hours
    await setCache(cacheKey, result, 48 * 60 * 60);

    return result;
  });
}
