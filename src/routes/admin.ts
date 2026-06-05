import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getApiKeysCollection } from '../services/mongodb.js';
import { randomBytes, createHash } from 'crypto';
import { clearCache } from '../services/cache.js';

const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  
  // Middleware to check admin key is handled globally in index.ts for simplicity
  // but we can also add a specific check here if needed.

  fastify.post('/admin/cache/clear', {
    schema: {
      description: 'Clear all cached data',
      tags: ['admin'],
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        }
      },
      security: [{ adminKey: [] }]
    }
  }, async (request, reply) => {
    await clearCache();
    return { message: 'Cache cleared' };
  });

  fastify.post('/admin/keys', {
    schema: {
      description: 'Generate a new API key',
      tags: ['admin'],
      body: {
        type: 'object',
        properties: {
          uses: { type: 'number', default: -1, description: 'Number of uses. -1 for infinite.' }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            uses: { type: 'number' }
          }
        }
      },
      security: [{ adminKey: [] }]
    }
  }, async (request, reply) => {
    const { uses = -1 } = request.body as { uses?: number };
    const rawKey = randomBytes(32).toString('hex'); // Generate a random key
    
    const collection = getApiKeysCollection();
    await collection.insertOne({
      key: rawKey,
      uses,
      createdAt: new Date()
    });

    return reply.code(201).send({ key: rawKey, uses });
  });

  fastify.get('/admin/keys', {
    schema: {
      description: 'List all API keys',
      tags: ['admin'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              uses: { type: 'number' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      },
      security: [{ adminKey: [] }]
    }
  }, async () => {
    const collection = getApiKeysCollection();
    return await collection.find({}).toArray();
  });

  fastify.delete('/admin/keys/:key', {
    schema: {
      description: 'Delete an API key',
      tags: ['admin'],
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' }
        }
      },
      response: {
        204: { type: 'null' }
      },
      security: [{ adminKey: [] }]
    }
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const collection = getApiKeysCollection();
    await collection.deleteOne({ key });
    return reply.code(204).send();
  });

  fastify.patch('/admin/keys/:key', {
    schema: {
      description: 'Update API key uses (set/add/deduct)',
      tags: ['admin'],
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          uses: { type: 'number', description: 'Set absolute uses' },
          increment: { type: 'number', description: 'Add or deduct uses' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            uses: { type: 'number' }
          }
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      },
      security: [{ adminKey: [] }]
    }
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const { uses, increment } = request.body as { uses?: number, increment?: number };
    const collection = getApiKeysCollection();

    let update: any = {};
    if (uses !== undefined) {
      update.$set = { uses };
    } else if (increment !== undefined) {
      update.$inc = { uses: increment };
    } else {
      return reply.code(400).send({ error: 'Provide uses or increment' });
    }

    const result = await collection.findOneAndUpdate(
      { key },
      update,
      { returnDocument: 'after' }
    );

    if (!result) {
      return reply.code(404).send({ error: 'Key not found' });
    }

    return result;
  });
};

export default adminRoutes;
