import Fastify from 'fastify';
import cors from '@fastify/cors';
import infoRoutes from './routes/info.ts';
import downloadRoutes from './routes/download.ts';

const fastify = Fastify({
  logger: true
});

// Register CORS
await fastify.register(cors, {
  origin: '*'
});

// Register Routes
await fastify.register(infoRoutes);
await fastify.register(downloadRoutes);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok' };
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
