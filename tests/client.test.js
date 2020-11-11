// @ts-check

import { test } from 'uvu';
import * as assert from 'uvu/assert';

import { Client } from '..';
import { asyncTest } from './util.js';

test('constructor throws for lack of an error listener', () => {
  let client;

  try {
    // @ts-expect-error
    client = new Client('pipe-emitter-test', {});
    assert.unreachable('did not throw');
  } catch (err) {
    assert.instance(err, TypeError);
  } finally {
    client && client.close();
  }

  try {
    // @ts-expect-error
    client = new Client('pipe-emitter-test', { onError: false });
    assert.unreachable('did not throw');
  } catch (err) {
    assert.instance(err, TypeError);
  } finally {
    client && client.close();
  }
});

test("triggers the onError() callback when there's an error", async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        for (const client of server.clients) {
          client.write('{'); // Send malformed JSON
        }
      },
    });

    useClient('pipe-emitter-test', {
      onError(err) {
        assert.is(err.type, 'RECEIVE_ERROR');
        done();
      },
    });
  });

  await asyncTest(({ done, useServer, useClient }) => {
    useServer('pipe-emitter-test', {
      onError() {},
    });

    const client = useClient('pipe-emitter-test', {
      onError(err) {
        assert.is(err.type, 'SOCKET_ERROR');
        assert.is(err.message, 'Bad socket');
        done();
      },
      onConnect() {
        client.server.emit('error', new Error('Bad socket'));
      },
    });
  });
});

test('triggers the onConnect() callback when connected to the server', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    useServer('pipe-emitter-test', {
      onError() {},
    });

    useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        done();
      },
    });
  });
});

test('triggers the onClose() callback when the server connection is closed', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        client.server.end();
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onClose(hadError) {
        assert.is(
          hadError,
          false,
          'hadError is false for a socket closed normally'
        );
        done();
      },
    });
  });

  await asyncTest(({ done, useServer, useClient }) => {
    useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        client.server.destroy(new Error('socket closed unexpectedly'));
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onClose(hadError) {
        assert.is(
          hadError,
          true,
          'hadError is true for a socket closed with an error'
        );
        done();
      },
    });
  });
});

test('emit() emits events to the server', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
    });

    let messagesReceived = 0;

    server.on('greeting-a', (data) => {
      messagesReceived++;
      assert.is(data, 'hai from client');
    });

    server.on('greeting-b', (data) => {
      messagesReceived++;
      assert.is(data, 'hai again from client');
      assert.is(messagesReceived, 2);

      done();
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {
        client.emit('greeting-a', 'hai from client');
        client.emit('greeting-b', 'hai again from client');
      },
    });
  });
});

test("on('*') listens to any event emitted from the server", async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        server.emit('greeting-a', 'hai from server');
        server.emit('greeting-b', 'hai again from server');
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
    });

    let messagesReceived = 0;

    client.on('*', (event, data) => {
      messagesReceived++;

      if (messagesReceived === 1) {
        assert.is(event, 'greeting-a');
        assert.is(data, 'hai from server');
      } else if (messagesReceived === 2) {
        assert.is(event, 'greeting-b');
        assert.is(data, 'hai again from server');
        assert.is(messagesReceived, 2);
        done();
      }
    });
  });
});

test('on(event) listens to a specific event from the server', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        server.emit('greeting', 'hai from server');
        server.emit('farewell', 'bye from server');
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
      onConnect() {},
    });

    let messagesReceived = 0;

    client.on('greeting', (data) => {
      messagesReceived++;
      assert.is(data, 'hai from server');
    });

    client.on('farewell', (data) => {
      messagesReceived++;

      assert.is(data, 'bye from server');
      assert.is(messagesReceived, 2);

      done();
    });
  });
});

test('off(event, handler) removes an event listener', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        // Send the first message
        server.emit('greeting', 'hai from server');
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
    });

    let handlerCalled = false;
    let handler = () => {
      assert.is(handlerCalled, false, 'the handler is called only once');
      handlerCalled = true;
    };

    client.on('greeting', handler);

    let messagesReceived = 0;

    client.on('*', () => {
      messagesReceived++;

      if (messagesReceived === 1) {
        // Remove the event listener after the first message
        client.off('greeting', handler);

        // Send the second message
        server.emit('greeting', 'hai again from server');
      } else if (messagesReceived === 2) {
        // End the test after the second message
        done();
      }
    });
  });
});

test('allOff() removes all event listeners', async () => {
  await asyncTest(({ done, useServer, useClient }) => {
    const server = useServer('pipe-emitter-test', {
      onError() {},
      onConnect() {
        // Send the first messages
        server.emit('greeting-a', 'hai from server');
        server.emit('greeting-b', 'hai from server');
      },
    });

    const client = useClient('pipe-emitter-test', {
      onError() {},
    });

    let handlerACalled = false;
    let handlerA = () => {
      assert.is(handlerACalled, false, 'the a handler is called only once');
      handlerACalled = true;
    };

    client.on('greeting-a', handlerA);

    let handlerBCalled = false;
    let handlerB = () => {
      assert.is(handlerBCalled, false, 'the b handler is called only once');
      handlerBCalled = true;
    };

    client.on('greeting-b', handlerB);

    let messagesReceived = 0;

    client.on('*', () => {
      messagesReceived++;

      if (messagesReceived === 2) {
        // Remove all the event listeners after the first messages
        client.allOff();

        // Add a new all event listener to end the test
        client.on('*', () => {
          messagesReceived++;

          if (messagesReceived === 4) {
            // End the test after the second messages
            done();
          }
        });

        // Send the second messages
        server.emit('greeting-a', 'hai again from server');
        server.emit('greeting-b', 'hai again from server');
      }
    });
  });
});

test.run();
