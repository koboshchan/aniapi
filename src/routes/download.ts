import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getVaplayerData, getVaplayerEpisodeStream } from '../services/vaplayer.ts';
import { fetchImdbMetadata } from '../services/metadata.ts';
import { paheSearch, paheGetAllEpisodes, paheExtractLinks, paheExtractM3U8 } from '../services/animepahe.ts';

export default async function downloadRoutes(fastify: FastifyInstance) {
  
  // Movie download
  fastify.get('/download/movie/:imdbId', async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;
    
    // Try Vaplayer first
    let vapData = await getVaplayerData(imdbId, 'movie');
    let streamUrl = vapData?.data?.stream_urls?.[0];
    
    // Fallback check (some movies are in movie endpoint, some in tv endpoint with eps:false)
    if (!streamUrl && vapData?.data?.eps === false) {
      vapData = await getVaplayerData(imdbId, 'movie');
      streamUrl = vapData?.data?.stream_urls?.[0];
    }

    if (!streamUrl) {
      return reply.status(404).send({ error: 'No stream found for this movie' });
    }

    return {
      streamUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
        'Referer': 'https://brightpathsignals.com/'
      }
    };
  });

  // Show download
  fastify.get('/download/show/:imdbId/:season/:episode', async (request: FastifyRequest<{ Params: { imdbId: string, season: string, episode: string } }>, reply: FastifyReply) => {
    const { imdbId, season, episode } = request.params;
    const s = parseInt(season);
    const e = parseInt(episode);

    // 1. Try Vaplayer
    let streamUrl = await getVaplayerEpisodeStream(imdbId, s, e);
    
    if (streamUrl) {
      return {
        streamUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0',
          'Referer': 'https://brightpathsignals.com/'
        }
      };
    }

    // 2. Fallback to AnimePahe
    console.log(`[Fallback] Vaplayer failed for ${imdbId} S${s}E${e}, trying AnimePahe...`);
    const meta = await fetchImdbMetadata(imdbId);
    
    // Simple search queries based on title
    const queries = s > 1 
      ? [`${meta.title} Season ${s}`, `${meta.title} ${s}nd Season`, meta.title]
      : [meta.title];
    
    let paheAnime = null;
    for (const q of queries) {
      const results = await paheSearch(q);
      if (results.length > 0) {
        paheAnime = results[0];
        break;
      }
    }

    if (paheAnime) {
      const episodes = await paheGetAllEpisodes(paheAnime.session);
      const ep = episodes.find(item => item.episode === e);
      if (ep) {
        const links = await paheExtractLinks(paheAnime.session, ep.session);
        const best = links.find(l => l.quality.includes('1080')) || 
                     links.find(l => l.quality.includes('720')) || 
                     links[0];
        
        if (best) {
          const m3u8 = await paheExtractM3U8(best.url);
          if (m3u8) {
            return {
              streamUrl: m3u8,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://kwik.si/'
              }
            };
          }
        }
      }
    }

    return reply.status(404).send({ error: 'No stream found for this episode' });
  });
}
