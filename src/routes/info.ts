import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fetchImdbMetadata, isShowType } from '../services/metadata.js';
import { getVaplayerData } from '../services/vaplayer.js';
import { animetsuSearch, findBestAnimetsuMatch, animetsuGetInfo, getAnimetsuSeasonEpisodes } from '../services/animetsu.js';
import { anikotoGetInfo, parseAnikotoId } from '../services/anikoto.js';
import { miruroGetInfo, parseMiruroId } from '../services/miruro.js';
import { getCache, setCache } from '../services/cache.js';

export function getImdbIdFromProviderSys(provider: string, id: string, args?: string | string[]): string {
  let resolvedArgs: string[] = [];
  if (args) {
    if (Array.isArray(args)) {
      resolvedArgs = args;
    } else {
      resolvedArgs = [args];
    }
  }
  
  const prov = provider.toLowerCase();
  if (prov === 'imdb' || prov === 'idmb') {
    return id;
  }
  if (prov === 'animetsu') {
    return `animetsu:${id}`;
  }
  if (prov === 'anikoto') {
    return resolvedArgs.length > 0 ? `anikoto:${id}:${resolvedArgs[0]}` : `anikoto:${id}`;
  }
  if (prov === 'miruro') {
    return resolvedArgs.length > 0 ? `miruro:${id}:${resolvedArgs[0]}` : `miruro:${id}`;
  }
  return `${provider}:${id}`;
}

async function handleInfoLookup(imdbId: string, request: FastifyRequest, reply: FastifyReply) {
  // Check Cache
  const cacheKey = `info:${imdbId}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  // Handle Miruro ID directly
  if (imdbId.startsWith('miruro:')) {
    const parsed = parseMiruroId(imdbId);
    if (!parsed) {
      return reply.status(404).send({ error: 'Invalid Miruro ID format' });
    }

    const miruroInfo = await miruroGetInfo(parsed.anilistId, parsed.category);
    const seasonCount = Object.keys(miruroInfo.episodes).length;
    const totalEpisodes = miruroInfo.episodes['1']?.length || 0;
    const isMovie = seasonCount <= 1 && totalEpisodes <= 1;

    const result = {
      imdbId,
      title: miruroInfo.title,
      originalTitle: miruroInfo.originalTitle,
      type: isMovie ? 'movie' : 'show',
      mediaType: isMovie ? 'movie' : 'show',
      genres: miruroInfo.genres,
      year: null,
      episodes: isMovie ? null : miruroInfo.episodes,
      hasPrimaryStream: totalEpisodes > 0
    };

    await setCache(cacheKey, result, 48 * 60 * 60);
    return result;
  }

  // Handle Anikoto ID directly
  if (imdbId.startsWith('anikoto:')) {
    const parsed = parseAnikotoId(imdbId);
    if (!parsed) {
      return reply.status(404).send({ error: 'Invalid Anikoto ID format' });
    }

    const anikotoInfo = await anikotoGetInfo(parsed.slug);
    const seasonEpisodes = anikotoInfo.episodes;
    const seasonCount = Object.keys(seasonEpisodes).length;
    const totalEpisodes = Object.values(seasonEpisodes).reduce((sum, eps) => sum + eps.length, 0);
    const isMovie = seasonCount === 1 && totalEpisodes === 1;

    const result = {
      imdbId,
      title: anikotoInfo.title,
      originalTitle: anikotoInfo.originalTitle,
      type: isMovie ? 'movie' : 'show',
      mediaType: isMovie ? 'movie' : 'show',
      genres: anikotoInfo.genres,
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
      hasPrimaryStream: true
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

  let vapData = await getVaplayerData(imdbId, vapType);

  if (!isShow) {
    stream_urls = vapData?.data?.stream_urls || [];
  } else {
    episodes = vapData?.data?.eps || null;

    if (!episodes) {
      console.log(`[Info Fallback] Vaplayer has no episodes for ${imdbId}, checking Animetsu...`);
      const searchResults = await animetsuSearch(meta.title);
      const match = findBestAnimetsuMatch(searchResults, meta.title, meta.startYear);
      
      if (match) {
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

  await setCache(cacheKey, result, 48 * 60 * 60);
  return result;
}

export default async function infoRoutes(fastify: FastifyInstance) {
  // GET /providers
  fastify.get('/providers', {
    schema: {
      description: 'Get list of supported providers and their argument options',
      tags: ['metadata'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              display_name: { type: 'string' },
              args: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    display_name: { type: 'string' },
                    args: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      },
      security: [{ apiKey: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return [
      {
        id: 'imdb',
        display_name: 'IMDb',
        args: []
      },
      {
        id: 'animetsu',
        display_name: 'Animetsu',
        args: []
      },
      {
        id: 'anikoto',
        display_name: 'Anikoto',
        args: [
          {
            id: 'audioType',
            display_name: 'Audio Type',
            args: ['sub', 'dub']
          }
        ]
      },
      {
        id: 'miruro',
        display_name: 'Miruro',
        args: [
          {
            id: 'category',
            display_name: 'Category',
            args: ['sub', 'ssub', 'dub']
          }
        ]
      }
    ];
  });

  // GET /info (Query Param based)
  fastify.get('/info', {
    schema: {
      description: 'Get metadata and stream/episode info by provider, ID, and optional arguments',
      tags: ['metadata'],
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
  }, async (request: FastifyRequest<{ Querystring: { provider: string, id: string, args?: string | string[] } }>, reply: FastifyReply) => {
    const { provider, id, args } = request.query;
    const imdbId = getImdbIdFromProviderSys(provider, id, args);
    return handleInfoLookup(imdbId, request, reply);
  });

  // GET /info/:imdbId (Legacy route)
  fastify.get('/info/:imdbId', {
    schema: {
      description: 'Get metadata and stream/episode info for a movie or show by IMDb ID',
      tags: ['metadata'],
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
    return handleInfoLookup(imdbId, request, reply);
  });
}
