// Transport abstraction. The game only ever calls send(msg) / onMessage(cb), so offline play
// (simulation in a Web Worker) and online play (Socket.io to the authoritative Node server)
// share every line of client code.

export class WorkerTransport {
  constructor(worker) {
    this.worker = worker;
    this.cb = null;
    worker.onmessage = (e) => this.cb && this.cb(e.data);
  }
  send(msg) { this.worker.postMessage(msg); }
  onMessage(cb) { this.cb = cb; }
  close() { this.worker.terminate(); }
}

export class SocketTransport {
  constructor(socket) {
    this.socket = socket;
    this.cb = null;
    socket.on('m', (msg) => this.cb && this.cb(msg));
  }
  send(msg) { this.socket.emit('m', msg); }
  onMessage(cb) { this.cb = cb; }
  close() { this.socket.emit('leave'); }
}
