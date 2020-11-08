import mitt, { Emitter } from 'mitt';
import net from 'net';

export type PipeError = Error & {
  type: 'SEND_ERROR' | 'RECEIVE_ERROR' | 'SOCKET_ERROR';
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

export class Server {
  private clients: Set<Socket>;
  private server: net.Server;
  private pipeName: string;
  private emitter: Emitter;
  private onError: ErrorListener;
  private onClose?: CloseListener;
  private onConnect?: ConnectListener;

  constructor(
    pipeName: string,
    options: {
      onError: ErrorListener;
      onConnect?: ConnectListener;
      onClose?: CloseListener;
    }
  ) {
    this.clients = new Set();
    this.emitter = mitt();

    this.onError = options.onError;
    this.onConnect = options.onConnect;
    this.onClose = options.onClose;

    this.pipeName = `\\\\.\\pipe\\${pipeName}`;
    this.server = (net.createServer as any)((clientSocket: Socket) => {
      this.onConnection(clientSocket);
    });

    this.server.listen(this.pipeName);
  }

  private onConnection(client: Socket) {
    this.clients.add(client);

    client.on('data', (data) => {
      try {
        const json = JSON.parse(data.toString());
        this.emitter.emit(json.event, json.data);
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
      this.onClose?.(hadError);
    });

    this.onConnect?.();

    this.emit('greeting', 'oh hai client');
  }

  /**
   * Get the number of clients connected to this server.
   */
  clientCount() {
    return this.clients.size;
  }

  /**
   * Emit the given event and data unto the pipe.
   *
   * @param {string|symbol} type The event type
   * @param {Any} [evt] Any value (object is recommended), passed to each handler
   */
  emit<T = any>(type: EventType, event?: T): void {
    for (const client of this.clients) {
      if (client.readyState === 'open' || client.readyState === 'writeOnly') {
        client.write(JSON.stringify({ event: type, data: event }));
      } else {
        const err = new Error('Client socket not open or writable');
        (err as PipeError).type = 'SEND_ERROR';
        throw err;
      }
    }
  }

  /**
   * Register an event handler for the given type.
   *
   * @param {string|symbol} type Type of event to listen for, or `"*"` for all events
   * @param {Function} handler Function to call in response to given event
   */
  on<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.on(type, handler);
  }

  /**
   * Remove an event handler for the given type.
   *
   * @param {string|symbol} type Type of event to unregister `handler` from, or `"*"`
   * @param {Function} handler Handler function to remove
   */
  off<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.off(type, handler);
  }
}

export class Client {
  private server: Socket;
  private pipeName: string;
  private emitter: Emitter;
  private onError: ErrorListener;
  private onConnect?: ConnectListener;
  private onClose?: CloseListener;

  constructor(
    pipeName: string,
    options: {
      onError: ErrorListener;
      onConnect?: ConnectListener;
      onClose?: CloseListener;
    }
  ) {
    this.emitter = mitt();

    this.onError = options.onError;
    this.onError = options.onError;
    this.onConnect = options.onConnect;
    this.onClose = options.onClose;

    this.pipeName = `\\\\.\\pipe\\${pipeName}`;
    this.server = net.createConnection(this.pipeName, () => {
      this.onConnection(this.server);
    }) as Socket;
  }

  private onConnection(server: Socket) {
    server.on('data', (data) => {
      try {
        const json = JSON.parse(data.toString());
        this.emitter.emit(json.event, json.data);
      } catch (err) {
        err.type = 'RECEIVE_ERROR';
        this.onError(err);
      }
    });

    server.on('error', (err) => {
      (err as any).type = 'SOCKET_ERROR';
      this.onError(err as PipeError);
    });

    server.on('close', (hadError: boolean) => {
      this.onClose?.(hadError);
    });

    this.onConnect?.();

    this.emit('greeting', 'oh hai server');
  }

  /**
   * Emit the given event and data unto the pipe.
   *
   * @param {string|symbol} type The event type
   * @param {Any} [evt] Any value (object is recommended), passed to each handler
   */
  emit<T = any>(type: EventType, event?: T): void {
    if (
      this.server.readyState == 'open' ||
      this.server.readyState == 'writeOnly'
    ) {
      this.server.write(JSON.stringify({ event: type, data: event }));
    } else {
      const err = new Error('Server socket not open or writable');
      (err as PipeError).type = 'SEND_ERROR';
      throw err;
    }
  }

  /**
   * Register an event handler for the given type.
   *
   * @param {string|symbol} type Type of event to listen for, or `"*"` for all events
   * @param {Function} handler Function to call in response to given event
   */
  on<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.on(type, handler);
  }

  /**
   * Remove an event handler for the given type.
   *
   * @param {string|symbol} type Type of event to unregister `handler` from, or `"*"`
   * @param {Function} handler Handler function to remove
   */
  off<T = any>(type: EventType, handler: Handler<T>) {
    this.emitter.off(type, handler);
  }
}
