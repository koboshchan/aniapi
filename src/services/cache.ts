import { getDb } from './mongodb.ts';

export async function getCache(key: string): Promise<any | null> {
  const db = getDb();
  const entry = await db.collection('cache').findOne({ key });
  
  if (!entry) return null;
  
  // MongoDB TTL index handles deletion, but double check here for safety if needed
  if (entry.expiresAt < new Date()) {
    return null;
  }
  
  return entry.data;
}

export async function setCache(key: string, data: any, ttlSeconds: number) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  
  await db.collection('cache').updateOne(
    { key },
    { 
      $set: { 
        data, 
        expiresAt,
        createdAt: new Date()
      } 
    },
    { upsert: true }
  );
}

export async function clearCache() {
  const db = getDb();
  await db.collection('cache').deleteMany({});
}
