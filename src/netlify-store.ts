import { getStore } from '@netlify/blobs';
import type { MealRecord, RecordStore } from './api';

export const RECORD_STORE_NAME = 'ai-meal-records';

// Site-wide storage survives deploys. Resolve credentials inside each request.
export function createRecordStore(openStore = () => getStore({
  name: RECORD_STORE_NAME,
  consistency: 'strong',
})): RecordStore {
  return {
    async save(record) {
      await openStore().setJSON(`records/${record.created_at}/${record.id}`, record);
    },
    async list(limit, offset) {
      const store = openStore();
      const { blobs } = await store.list({ prefix: 'records/' });
      // Blobs is key-value storage. Enumerate keys for this small-record MVP;
      // fetch only the requested page's values, preserving the D1 sort order.
      const keys = blobs.map(({ key }) => key).sort().reverse().slice(offset, offset + limit);
      return Promise.all(keys.map(async key => {
        const record = await store.get(key, { type: 'json' }) as MealRecord | null;
        if (!record) throw new Error('Record unavailable');
        return record;
      }));
    },
  };
}
