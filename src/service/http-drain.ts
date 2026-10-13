import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

// Bound transport draining, not persistence: a disconnected handler must still
// settle before its stores close. Tests may shorten this internal transport grace.
export const HTTP_DRAIN_MS = 5000;
export function createDrainingServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  graceMs = HTTP_DRAIN_MS,
) {
  const sockets = new Map<Socket, { responses: number }>();
  const tasks = new Set<Promise<void>>();
  let draining = false;
  let closed: Promise<void> | undefined;
  const track = (socket: Socket) => {
    let state = sockets.get(socket);
    if (!state) {
      state = { responses: 0 };
      sockets.set(socket, state);
      socket.once('close', () => sockets.delete(socket));
    }
    return state;
  };
  const server = createServer((req, res) => {
    const socket = req.socket, state = track(socket);
    state.responses++;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      res.removeListener('finish', done);
      res.removeListener('close', done);
      state.responses--;
      // Flush queued output before releasing the socket; do not wait for peer FIN.
      if (draining && state.responses === 0) socket.destroySoon();
    };
    res.once('finish', done);
    res.once('close', done);
    const task = handler(req, res);
    tasks.add(task);
    void task.catch(() => res.destroy()).finally(() => tasks.delete(task));
  });
  server.on('connection', (socket) => {
    track(socket);
    // Include accepted preconnections and connections delivered during close.
    if (draining) socket.destroySoon();
  });
  return {
    server,
    close: () => {
      if (closed) return closed;
      draining = true;
      const transport = new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
      const deadline = setTimeout(() => {
        // A stalled body/reader cannot retain the listener forever. Persistence
        // still waits for the associated handler, including work after disconnect.
        for (const socket of sockets.keys()) socket.destroy();
      }, graceMs);
      for (const [socket, state] of sockets)
        if (state.responses === 0) socket.destroySoon();
      closed = (async () => {
        try {
          await transport;
          while (tasks.size) await Promise.allSettled([...tasks]);
        } finally {
          clearTimeout(deadline);
        }
      })();
      return closed;
    },
  };
}
