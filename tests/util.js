import { Server, Client } from '..';

export function asyncTest(testFn, options = {}) {
  const { timeout } = Object.assign({}, { timeout: 3 }, options);

  const servers = new Set();
  const clients = new Set();

  function useServer(pipeName, options) {
    const server = new Server(pipeName, options);
    servers.add(server);
    return server;
  }

  function useClient(pipeName, options) {
    const client = new Client(pipeName, options);
    clients.add(client);
    return client;
  }

  return new Promise((resolve) => {
    async function cleanUp() {
      for (const client of clients) {
        clients.delete(client);
        client.close();
      }

      for (const server of servers) {
        servers.delete(server);
        await server.close();
      }
    }

    async function done() {
      await cleanUp();
      resolve();
    }

    if (timeout > 0) {
      setTimeout(async () => {
        await cleanUp();
        throw new Error(`async test timed out after ${timeout} seconds`);
      }, timeout * 1000);
    }

    testFn({ done, useServer, useClient });
  });
}
