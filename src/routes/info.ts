import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fetchImdbMetadata, isShowType } from '../services/metadata.js';
import { getVaplayerData } from '../services/vaplayer.js';
import { animetsuSearch, findBestAnimetsuMatch, animetsuGetInfo, getAnimetsuSeasonEpisodes } from '../services/animetsu.js';
import { anikotoGetSeasonEpisodes, parseAnikotoId } from '../services/anikoto.js';
import { getCache, setCache } from '../services/cache.js';

export default async function infoRoutes(fastify: FastifyInstance) {
  fastify.get('/info/:imdbId', {
    schema: {
      description: 'Get metadata and stream/episode info for a movie or show by IMDb ID',
      tags: ['metadata'],
      params: {
        type: 'object',
        properties: {
          imdbId: { type: 'string', description: 'IMDb ID (e.g. tt1234567), Animetsu ID (animetsu:id), or Anikoto ID (anikoto:id[:sub/dub])' }
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

    // Handle Anikoto ID directly
    if (imdbId.startsWith('anikoto:')) {
      const parsed = parseAnikotoId(imdbId);
      if (!parsed) {
        return reply.status(404).send({ error: 'Invalid Anikoto ID format' });
      }

      const seasonEpisodes = await anikotoGetSeasonEpisodes(parsed.slug);
      const seasonCount = Object.keys(seasonEpisodes).length;
      const totalEpisodes = Object.values(seasonEpisodes).reduce((sum, eps) => sum + eps.length, 0);
      const isMovie = seasonCount === 1 && totalEpisodes === 1;

      const result = {
        imdbId,
        title: parsed.slug,
        originalTitle: parsed.slug,
        type: isMovie ? 'movie' : 'show',
        mediaType: isMovie ? 'movie' : 'show',
        genres: [],
        year: null,
        episodes: isMovie ? null : seasonEpisodes,
        hasPrimaryStream: totalEpisodes > 0
      };

      await setCache(cacheKey, result, 48 * 60 * 60);
      return result;
    }

    // Handle Animetsu ID directly
    if (imdbId.startsWith('animetsu:')) {
      const animetsuId = imdbId.split(':')[1];
      const anime = await animetsuGetInfo(animetsuId);
      
      if (!anime) {
        return reply.status(404).send({ error: 'Anime not found on Animetsu' });
      }

      // Format response to match standard info format with season-aware episode map.
      const seasonEpisodes = getAnimetsuSeasonEpisodes(anime);
      const isShow = Object.keys(seasonEpisodes).length > 0 && (
        Object.keys(seasonEpisodes).length > 1 || (seasonEpisodes['1']?.length || 0) > 1
      );
      const episodes = isShow ? seasonEpisodes : null;

      const result = {
        imdbId,
        title: anime.title.english || anime.title.romaji,
        originalTitle: anime.title.romaji || anime.title.english,
        type: isShow ? 'show' : 'movie',
        mediaType: isShow ? 'show' : 'movie',
        genres: anime.genres || [],
        year: anime.year,
        episodes: episodes,
        hasPrimaryStream: true // If we have the ID, we assume it has streams on Animetsu
      };

      await setCache(cacheKey, result, 48 * 60 * 60);
      return result;
    }

    const meta = await fetchImdbMetadata(imdbId);
    const isShow = isShowType(meta.type);
    const mediaType = isShow ? 'show' : 'movie';
    const vapType = isShow ? 'tv' : 'movie';
    
    let episodes: any = null;
    let stream_urls: string[] = [];

    // 1. Try Vaplayer (Primary)
    let vapData = await getVaplayerData(imdbId, vapType);

    if (!isShow) {
      stream_urls = vapData?.data?.stream_urls || [];
    } else {
      episodes = vapData?.data?.eps || null;

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
      year: (meta as any).startYear || (meta as any).year || null,
      episodes: episodes,
      hasPrimaryStream: !isShow ? stream_urls.length > 0 : episodes !== null
    };

    // Cache for 48 hours
    await setCache(cacheKey, result, 48 * 60 * 60);

    return result;
  });
}
