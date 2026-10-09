import { BlobsServer } from '@netlify/blobs/server';

// @netlify/blobs 11.1.3's dev server omits ETags on GET and its PUT
// precondition/read/write sequence is not atomic. This LOCAL-ONLY adapter
// supplies the production contract for integration tests. Cloud CAS must also
// be checked against the real service; this adapter is never deployed.
export class SessionTestBlobsServer extends BlobsServer {
  queue = Promise.resolve();
  async get(req) {
    const response = await super.get(req);
    const { dataPath, key } = this.getLocalPaths(new URL(req.url, this.address));
    if (response.ok && dataPath && key) response.headers.set('etag', await BlobsServer.generateETag(dataPath));
    return response;
  }
  async put(req) {
    const run = this.queue.then(() => super.put(req));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
