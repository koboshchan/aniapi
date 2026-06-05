import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fetchImdbMetadata, isShowType } from '../services/metadata.ts';
import { getVaplayerData } from '../services/vaplayer.ts';
import { animetsuSearch } from '../services/animetsu.ts';

export default async function infoRoutes(fastify: FastifyInstance) {
  fastify.get('/info/:imdbId', async (request: FastifyRequest<{ Params: { imdbId: string } }>, reply: FastifyReply) => {
    const { imdbId } = request.params;
    
    const meta = await fetchImdbMetadata(imdbId);
    const isShow = isShowType(meta.type);
    const mediaType = isShow ? 'show' : 'movie';
    
    let episodes: any = null;
    let stream_urls: string[] = [];

    if (!isShow) {
      const vapData = await getVaplayerData(imdbId, 'movie');
      stream_urls = vapData?.data?.stream_urls || [];
    } else {
      const vapData = await getVaplayerData(imdbId, 'tv');
      episodes = vapData?.data?.eps || null;

      // Fallback to Animetsu if Vaplayer has no episodes
      if (!episodes) {
        console.log(`[Info Fallback] Vaplayer has no episodes for ${imdbId}, checking Animetsu...`);
        const searchResults = await animetsuSearch(meta.title);
        if (searchResults.length > 0) {
          const match = searchResults[0];
          // Generate an array of strings ["1", "2", ..., "N"] to match Vaplayer's format
          const epArray = Array.from({ length: match.total_eps }, (_, i) => (i + 1).toString());
          episodes = { "1": epArray };
          console.log(`[Info Fallback] Found on Animetsu: ${match.title.english || match.title.romaji} (${match.total_eps} eps)`);
        }
      }
    }

    return {
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
  });
}
