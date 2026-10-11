const net = require('node:net');

function fail(code) { const error = new Error(code); error.code = code; return error; }

function createHostClient({socketPath, token, applicationId, launchId, timeoutMs = 15000} = {}) {
  if (!socketPath || !token || !applicationId || !launchId) throw fail('HOST_SESSION_MISSING');
  let closed = false;
  let nextId = 0;
  async function call(method, params) {
    if (closed) throw fail('HOST_SESSION_CLOSED');
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let buffer = '';
      let settled = false;
      const timer = setTimeout(() => finish(fail('HOST_REQUEST_TIMEOUT')), timeoutMs);
      timer.unref();
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        error ? reject(error) : resolve(value);
      };
      socket.setEncoding('utf8');
      socket.on('error', () => finish(fail('HOST_UNAVAILABLE')));
      socket.on('data', (chunk) => {
        buffer += chunk;
        const index = buffer.indexOf('\n');
        if (index < 0) return;
        const line = buffer.slice(0, index);
        try {
          const reply = JSON.parse(line);
          if (!reply.ok) return finish(fail(reply.error || 'HOST_REQUEST_FAILED'));
          finish(null, reply.value);
        } catch { finish(fail('HOST_INVALID_RESPONSE')); }
      });
      socket.on('connect', () => socket.end(JSON.stringify({
        id: String(++nextId), token, applicationId, launchId, method, params,
      }) + '\n'));
    });
  }
  async function context() { return call('context.get'); }
  async function request(path, {method = 'GET', body, headers} = {}) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) throw fail('HOST_BODY_UNSUPPORTED');
    const params = {path, method, headers};
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      params.body = Buffer.from(body).toString('base64');
      params.bodyEncoding = 'base64';
    } else if (body !== undefined) params.body = body;
    const value = await call('http.request', params);
    const bytes = Buffer.from(value.body || '', 'base64');
    return new Response(bytes, {status: value.status, headers: value.headers || {}});
  }
  return Object.freeze({context, request, close() { closed = true; }});
}

function fromEnvironment(env = process.env) {
  if (!env.WANX_HOST_SOCKET) return null;
  return createHostClient({
    socketPath: env.WANX_HOST_SOCKET,
    token: env.WANX_HOST_TOKEN,
    applicationId: env.WANX_HOST_CLIENT_APPLICATION_ID || env.WANX_HOST_APPLICATION_ID,
    launchId: env.WANX_HOST_LAUNCH_ID,
  });
}

module.exports = {createHostClient, fromEnvironment};
