import { MongoClient, Db, Collection } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aniapi';
const client = new MongoClient(uri);

let db: Db;

export interface ApiKey {
  key: string;
  uses: number; // -1 for infinite
  createdAt: Date;
}

export interface CacheEntry {
  key: string;
  data: any;
  createdAt: Date;
  expiresAt: Date;
}

export async function connectToDatabase() {
  try {
    console.log(`Connecting to MongoDB at ${uri}...`);
    await client.connect();
    db = client.db();
    console.log('Connected to MongoDB successfully');
    
    // Ensure index on key
    await db.collection('api_keys').createIndex({ key: 1 }, { unique: true });
    
    // Ensure TTL index on expiresAt for cache
    await db.collection('cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection('cache').createIndex({ key: 1 }, { unique: true });
    
    return db;
  } catch (error) {
    console.error('CRITICAL: Failed to connect to MongoDB');
    console.error(error);
    process.exit(1);
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase first.');
  }
  return db;
}

export function getApiKeysCollection(): Collection<ApiKey> {
  return getDb().collection<ApiKey>('api_keys');
}
