import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { fetchImdbMetadata, isShowType } from '../services/metadata.ts';
import { getVaplayerData } from '../services/vaplayer.ts';

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
