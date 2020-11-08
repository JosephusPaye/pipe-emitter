// @ts-check
import { Server, Client } from '..';

const pipeName = 'win-duplex-pipe-test';

const server = new Server(pipeName, {
  onError(err) {
    console.log('server error', err);
  },
  onConnect() {
    console.log('client connected');
    server.emit('microphone', 'this is part two tho');
  },
  onClose(hadError) {
    console.log('client closed', { hadError });
  },
});

server.on('*', (event, data) => {
  console.log('got event from client', event, data);
});

const client = new Client(pipeName, {
  onError(err) {
    console.log('client error', err);
  },
  onConnect() {
    console.log('server connected');
    server.emit('our-house', 'inside this mighty fine pen');
  },
  onClose(hadError) {
    console.log('server closed', { hadError });
  },
});

client.on('*', (event, data) => {
  console.log('got event from server', event, data);
});
