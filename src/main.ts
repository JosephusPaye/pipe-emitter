import mitt, { Emitter } from 'mitt';
import net from 'net';

export type PipeError = Error & {
  type: 'SEND_ERROR' | 'RECEIVE_ERROR' | 'SERVER_ERROR' | 'SOCKET_ERROR';
};
export type EventType = string | symbol;
export type Handler<T = any> = (event?: T) => void;
export type WildcardHandler = (type: EventType, event?: any) => void;
export type ErrorListener = (err: PipeError) => void;
export type ConnectListener = () => void;
export type CloseListener = (hadError: boolean) => void;

type Socket = net.Socket & {
  readonly readyState: 'opening' | 'open' | 'readOnly' | 'writeOnly';
};

const PACKET_DELIMITER = '<<pipe-emitter>>';

/**
 * A server for creating IPC pipes (UNIX domain pipes or named pipes on Windows).
 * Supports bi-directional communication with clients that connect.
 */
export class Server {
  private clients: Set<Socket>;
  private server: net.Server;
  private pipeName: string;
  private emitter: Emitter;
  private onError: ErrorListener;
  private onDisconnect?: CloseListener;
  private onConnect?: ConnectListener;

  /**
   * Create a new pipe server that clients can connect to. See [the Node.js docs](https://nodejs.org/docs/latest-v14.x/api/net.html#net_identifying_paths_for_ipc_connections)
   * for pipe name format and valid characters.
   *
   * @param pipeName The name of the pipe, globally unique at the OS level
   * @param options
   */
  constructor(
    pipeName: string,
    options: {
      onError: ErrorListener;
      onConnect?: ConnectListener;
      onDisconnect?: CloseListener;
    }
  ) {
    if (typeof options.onError !== 'function') {
      throw new TypeError('options.onError is required and must be a function');
    }

    this.clients = new Set();
    this.emitter = mitt();

    this.onError = options.onError;
    this.onConnect = options.onConnect;
    this.onDisconnect = options.onDisconnect;

    this.pipeName = `\\\\.\\pipe\\${pipeName}`;
    this.server = (net.createServer as any)((clientSocket: Socket) => {
      this.onConnection(clientSocket);
    });

    this.server.on('error', (err) => {
      (err as any).type = 'SERVER_ERROR';
      this.onError(err as PipeError);
    });

    this.server.listen(this.pipeName);
  }

  /**
   * Handle a new client connection.
   */
  private onConnection(client: Socket) {
    this.clients.add(client);

    client.on('data', (buffer) => {
      try {
        const packets = buffer.toString().split(PACKET_DELIMITER);

        for (const packet of packets) {
          if (packet) {
            const json = JSON.parse(packet);
            this.emitter.emit(json.event, json.data);
          }
        }
      } catch (err) {
        err.type = 'RECEIVE_ERROR';
        this.onError(err);
      }
    });

    client.on('error', (err) => {
      (err as any).type = 'SOCKET_ERROR';
      this.onError(err as PipeError);
    });

    client.on('close', (hadError: boolean) => {
      this.clients.delete(client);
      this.onDisconnect?.(hadError);
    });

    this.onConnect?.();
  }

  /**
   * Get the number of clients connected to this pipe.
   */
  clientCount() {
    return this.clients.size;
  }

  /**
   * Emit the given event and data unto the pipe. Will throw an error of type "SEND_ERROR"
   * if a client socket is not writable (e.g. not ready or already closed).
   *
   * @param {string|symbol} event The event type
   * @param {Any} [data] Any value (object is recommended), passed to each handler
   */
  emit<T = any>(event: EventType, data?: T): void {
    for (const client of this.clients) {
      if (client.readyState === 'open' || client.readyState === 'writeOnly') {
        client.write(JSON.stringify({ event, data }) + PACKET_DELIMITER);
      } else {
        const err = new Error('Client socket not open or writable');
        (err as PipeError).type = 'SEND_ERROR';
        throw err;
      }
    }
  }

  /**
   * Register an event handler for the given type on this pipe.
   *
   * @param {string|symbol} type Type of event to listen for, or `"*"` for all events
   * @param {Function} handler Function to call in response to given event
   */
  on<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.on(type, handler);
  }

  /**
   * Remove an event handler for the given type on this pipe.
   *
   * @param {string|symbol} type Type of event to unregister `handler` from, or `"*"`
   * @param {Function} handler Handler function to remove
   */
  off<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.off(type, handler);
  }

  /**
   * Remove all event listeners.
   */
  allOff() {
    this.emitter.all.clear();
  }

  /**
   * Close the pipe and clear event listeners.
   */
  async close() {
    this.emitter.all.clear();

    for (const pipe of this.clients) {
      pipe.end();
    }

    this.clients.clear();
    this.server.removeAllListeners();

    await new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        }

        resolve();
      });
    });
  }
}

/**
 * A client for connecting to IPC pipes (UNIX domain pipes or named pipes on Windows).
 * Supports bi-directional communication with the server it's connected to.
 */
export class Client {
  private server: Socket;
  private pipeName: string;
  private emitter: Emitter;
  private onError: ErrorListener;
  private onConnect?: ConnectListener;
  private onDisconnect?: CloseListener;

  /**
   * Create a new pipe client and connect it to the given pipe.
   *
   * @param pipeName The name of the pipe to connect to
   * @param options
   */
  constructor(
    pipeName: string,
    options: {
      onError: ErrorListener;
      onConnect?: ConnectListener;
      onDisconnect?: CloseListener;
    }
  ) {
    if (typeof options.onError !== 'function') {
      throw new TypeError('options.onError is required and must be a function');
    }

    this.emitter = mitt();

    this.onError = options.onError;
    this.onConnect = options.onConnect;
    this.onDisconnect = options.onDisconnect;

    this.pipeName = `\\\\.\\pipe\\${pipeName}`;

    this.server = net.createConnection(this.pipeName, () => {
      this.onConnect?.();
    }) as Socket;

    this.server.on('data', (buffer) => {
      try {
        const packets = buffer.toString().split(PACKET_DELIMITER);

        for (const packet of packets) {
          if (packet) {
            const json = JSON.parse(packet);
            this.emitter.emit(json.event, json.data);
          }
        }
      } catch (err) {
        err.type = 'RECEIVE_ERROR';
        this.onError(err);
      }
    });

    this.server.on('error', (err) => {
      (err as any).type = 'SOCKET_ERROR';
      this.onError(err as PipeError);
    });

    this.server.on('close', (hadError: boolean) => {
      this.onDisconnect?.(hadError);
    });
  }

  /**
   * Emit the given event and data unto the pipe. Will throw an error of type "SEND_ERROR"
   * if the server socket is not writable (e.g. not ready or already closed).
   *
   * @param {string|symbol} event The event type
   * @param {Any} [data] Any value (object is recommended), passed to each handler
   */
  emit<T = any>(event: EventType, data?: T): void {
    if (
      this.server.readyState == 'open' ||
      this.server.readyState == 'writeOnly'
    ) {
      this.server.write(JSON.stringify({ event, data }) + PACKET_DELIMITER);
    } else {
      const err = new Error('Server socket not open or writable');
      (err as PipeError).type = 'SEND_ERROR';
      throw err;
    }
  }

  /**
   * Register an event handler for the given type on this pipe.
   *
   * @param {string|symbol} type Type of event to listen for, or `"*"` for all events
   * @param {Function} handler Function to call in response to given event
   */
  on<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.on(type, handler);
  }

  /**
   * Remove an event handler for the given type on this pipe.
   *
   * @param {string|symbol} type Type of event to unregister `handler` from, or `"*"`
   * @param {Function} handler Handler function to remove
   */
  off<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.off(type, handler);
  }

  /**
   * Remove all event listeners.
   */
  allOff() {
    this.emitter.all.clear();
  }

  /**
   * Close the pipe and clear event listeners.
   */
  close() {
    this.emitter.all.clear();
    this.server.end();
  }
}
