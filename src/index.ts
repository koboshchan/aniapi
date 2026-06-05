import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomBytes, createHash } from 'crypto';
import infoRoutes from './routes/info.js';
import downloadRoutes from './routes/download.js';
import adminRoutes from './routes/admin.js';
import { connectToDatabase, getApiKeysCollection } from './services/mongodb.js';

// Generate Ephemeral Admin Key
const rawAdminBytes = randomBytes(256);
const adminKey = createHash('sha256').update(rawAdminBytes).digest('hex');

const fastify = Fastify({
  logger: true
});

// Register Swagger
await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'AniAPI Documentation',
      description: 'API for movie and show metadata and streams',
      version: '1.0.0'
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'x-api-key',
          in: 'header'
        },
        adminKey: {
          type: 'apiKey',
          name: 'x-api-key',
          in: 'header'
        }
      }
    }
  }
});

await fastify.register(swaggerUi, {
  routePrefix: '/documentation',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false
  }
});

// Register CORS
await fastify.register(cors, {
  origin: '*'
});

// Auth Hook
fastify.addHook('preHandler', async (request, reply) => {
  const url = request.url;
  // Skip auth for documentation and health
  if (url.startsWith('/documentation') || url === '/health' || url === '/favicon.ico') {
    return;
  }

  const apiKeyHeader = request.headers['x-api-key'];

  if (!apiKeyHeader) {
    return reply.code(401).send({ error: 'Missing x-api-key header' });
  }

  // Check Admin Key
  if (apiKeyHeader === adminKey) {
    return; // Admin has full access
  }

  // Restrict admin routes to admin key ONLY
  if (url.startsWith('/admin/')) {
    return reply.code(403).send({ error: 'Admin key required for this endpoint' });
  }

  // Check standard API keys in DB
  const collection = getApiKeysCollection();
  const keyDoc = await collection.findOne({ key: apiKeyHeader as string });

  if (!keyDoc) {
    return reply.code(403).send({ error: 'Invalid API key' });
  }

  if (keyDoc.uses === 0) {
    return reply.code(403).send({ error: 'API key has no uses left' });
  }

  // Deduct use if not infinite
  if (keyDoc.uses !== -1) {
    await collection.updateOne(
      { key: apiKeyHeader as string },
      { $inc: { uses: -1 } }
    );
  }
});

// Register Routes
await fastify.register(infoRoutes);
await fastify.register(downloadRoutes);
await fastify.register(adminRoutes);

// Health check
fastify.get('/health', {
  schema: {
    description: 'Health check endpoint',
    tags: ['system'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          mongodb: { type: 'string' }
        }
      }
    }
  }
}, async () => {
  let mongoStatus = 'connected';
  try {
    const coll = getApiKeysCollection();
    await coll.countDocuments();
  } catch (e) {
    mongoStatus = 'disconnected';
  }
  return { status: 'ok', mongodb: mongoStatus };
});

const start = async () => {
  try {
    await connectToDatabase();
    const port = parseInt(process.env.PORT || '3000');
    await fastify.listen({ port, host: '0.0.0.0' });
    
    console.log('====================================');
    console.log(`ADMIN KEY: ${adminKey}`);
    console.log('====================================');
    console.log(`Server listening on http://localhost:${port}`);
    console.log(`Documentation available at http://localhost:${port}/documentation`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
