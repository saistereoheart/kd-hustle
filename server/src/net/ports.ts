import net from 'node:net';

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err: NodeJS.ErrnoException) => {
      // An address family that doesn't exist on this machine (e.g. no IPv6) isn't "busy".
      resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
    });
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/**
 * On Windows another program can hold 127.0.0.1:PORT while we still manage to bind
 * 0.0.0.0:PORT, and then "localhost" silently reaches the other program. So a port only
 * counts as free if all of 0.0.0.0, 127.0.0.1 and ::1 are free.
 */
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '::1', '0.0.0.0']) {
    if (!(await canBind(port, host))) return false;
  }
  return true;
}
