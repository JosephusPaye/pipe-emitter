// @ts-check

import { test } from 'uvu';
import * as assert from 'uvu/assert';

import { Server } from '..';
import { asyncTest } from './util.js';

test('constructor throws for lack of an error listener', () => {
  let server;

  try {
    // @ts-expect-error
    server = new Server('pipe-emitter-test', {});
    assert.unreachable('did not throw');
  } catch (err) {
    assert.instance(err, TypeError);
  } finally {
    server && server.close();
  }

  try {
    // @ts-expect-error
    server = new Server('pipe-emitter-test', { onError: false });
    assert.unreachable('did not throw');
  } catch (err) {
    assert.instance(err, TypeError);
  } finally {
    server && server.close();
  }
});

test("triggers the onError() callback when there's an error", async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    useServer('pipe-emitter-test', {
      onError(err) {
        assert.is(err.type, 'RECEIVE_ERROR');
        done();
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        client.server.write('{'); // Send malformed JSON
      },
    });
  });

  await asyncTest(({ done, useServer }) => {
    const server = useServer('pipe-emitter-test', {
      onError(err) {
        assert.is(err.type, 'SERVER_ERROR');
        assert.is(err.message, 'Bad server');
        done();
      },
    });

    server.server.emit('error', new Error('Bad server'));
  });

  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError(err) {
        assert.is(err.type, 'SOCKET_ERROR');
        assert.is(err.message, 'Bad socket');
        done();
      },

      onConnect() {
        for (const client of server.clients) {
          client.emit('error', new Error('Bad socket'));
          break;
        }
      },
    });

    useClient('pipe-emitter-test', {
      onError() {},
    });
  });
});

test("triggers the onConnect() callback when there's a client connection", async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    let connectionCount = 0;

    useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        connectionCount++;

        if (connectionCount == 2) {
          assert.ok(connectionCount == 2, 'onConnect() was triggered twice');
          done();
        }
      },
    });

    useClient('pipe-emitter-test', {
      onError() {},
    });

    useClient('pipe-emitter-test', {
      onError() {},
    });
  });
});

test('triggers the onDisconnect() callback when a client connection is closed', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    useServer('pipe-emitter-test', {
      onError() {},
      onDisconnect(hadError) {
        assert.is(
          hadError,
          false,
          'hadError is false for a client socket closed normally'
        );

        done();
      },
      onConnect() {
        client.server.end();
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
    });
  });

  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onDisconnect(hadError) {
        assert.is(
          hadError,
          true,
          'hadError is true for a client socket closed with an error'
        );

        done();
      },
      onConnect() {
        for (const client of server.clients) {
          client.destroy(new Error('closed unexpectedly'));
        }
      },
    });

    useClient('pipe-emitter-test', {
      onError() {},
    });
  });
});

test('clientCount() counts the number of connected clients', async () => {
  let totalConnected = 0;
  let closeHandled = false;

  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        totalConnected++;

        // Check the count after two clients are connected
        if (totalConnected === 2) {
          assert.is(server.clientCount(), 2);

          // Disconnect one of the clients
          clientA.close();
        }
      },
      onDisconnect() {
        if (closeHandled) {
          return;
        }

        closeHandled = true;

        // One of the clients was disconnect, count should now be 1
        assert.is(server.clientCount(), 1);

        done();
      },
    });

    // Check the initial count
    assert.is(server.clientCount(), 0, 'initial client count is 0');

    // Connect two clients initially
    const clientA = useClient('pipe-emitter-test', {
      onError() {},
    });

    useClient('pipe-emitter-test', {
      onError() {},
    });
  });
});

test('emit() emits an event to all connected clients', async () => {
  let messagesReceived = 0;

  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        if (server.clientCount() === 2) {
          server.emit('greeting', 'oh hai clients');
        }
      },
    });

    const clientA = useClient('pipe-emitter-test', {
      onError() {},
    });

    clientA.on('greeting', (data) => {
      assert.is(data, 'oh hai clients');

      messagesReceived++;

      if (messagesReceived === 2) {
        done();
      }
    });

    const clientB = useClient('pipe-emitter-test', {
      onError() {},
    });

    clientB.on('greeting', (data) => {
      assert.is(data, 'oh hai clients');

      messagesReceived++;

      if (messagesReceived === 2) {
        done();
      }
    });
  });
});

test("on('*') listens to any event emitted to the server", async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
    });

    let messagesReceived = 0;

    server.on('*', (event, data) => {
      messagesReceived++;

      if (messagesReceived === 1) {
        assert.is(event, 'greeting-from-a');
        assert.is(data, 'hai from client a');
      } else if (messagesReceived === 2) {
        assert.is(event, 'greeting-from-b');
        assert.is(data, 'hai from client b');

        done();
      }
    });

    const clientA = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        clientA.emit('greeting-from-a', 'hai from client a');
      },
    });

    const clientB = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        clientB.emit('greeting-from-b', 'hai from client b');
      },
    });
  });
});

test('on(event) listens to a specific event from any client', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
    });

    let messagesReceived = 0;

    server.on('greeting', (data) => {
      messagesReceived++;

      if (messagesReceived === 1) {
        assert.is(data, 'hai from client a');
      }

      if (messagesReceived === 2) {
        assert.is(data, 'hai from client b');
        done();
      }
    });

    const clientA = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        clientA.emit('greeting', 'hai from client a');
        clientA.emit('goodbye', 'bye from client a');
      },
    });

    const clientB = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        clientB.emit('greeting', 'hai from client b');
        clientB.emit('goodbye', 'bye from client b');
      },
    });
  });
});

test('off(event, handler) removes an event listener', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
    });

    let handler;
    let messagesReceived = 0;

    server.on('*', () => {
      messagesReceived++;

      if (messagesReceived === 1) {
        // Remove the event listener after the first message
        server.off('greeting', handler);

        // Send the second message
        client.emit('greeting', 'hai again from client');
      } else if (messagesReceived === 2) {
        // End the test after the second message
        done();
      }
    });

    let handlerCalled = false;
    handler = () => {
      assert.is(handlerCalled, false, 'the handler is called only once');
      handlerCalled = true;
    };

    server.on('greeting', handler);

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        // Send the first message
        client.emit('greeting', 'hai from client');
      },
    });
  });
});

test('allOff() removes all event listeners', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
    });

    let handlerA;
    let handlerB;
    let messagesReceived = 0;

    server.on('*', () => {
      messagesReceived++;

      if (messagesReceived === 2) {
        // Remove all the event listeners after the first messages
        server.allOff();

        // Add a new all event listener to end the test
        server.on('*', () => {
          messagesReceived++;

          if (messagesReceived === 4) {
            // End the test after the second messages
            done();
          }
        });

        // Send the second messages
        client.emit('greeting-a', 'hai again from client');
        client.emit('greeting-b', 'hai again from client');
      }
    });

    let handlerACalled = false;
    handlerA = () => {
      assert.is(handlerACalled, false, 'the a handler is called only once');
      handlerACalled = true;
    };

    server.on('greeting-a', handlerA);

    let handlerBCalled = false;
    handlerB = () => {
      assert.is(handlerBCalled, false, 'the b handler is called only once');
      handlerBCalled = true;
    };

    server.on('greeting-b', handlerB);

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        // Send the first messages
        client.emit('greeting-a', 'hai from client');
        client.emit('greeting-b', 'hai from client');
      },
    });
  });
});

test.run();
