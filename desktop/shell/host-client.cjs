const net = require('node:net');
const {EventEmitter} = require('node:events');

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
  function openStream(path, {headers, protocols} = {}) {
    if (closed) return Promise.reject(fail('HOST_SESSION_CLOSED'));
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      const emitter = new EventEmitter();
      const openId = String(nextId + 1);
      let streamId = null;
      let buffer = '';
      let settled = false;
      let readyState = 0;
      const timer = setTimeout(() => finishOpen(fail('HOST_STREAM_TIMEOUT')), timeoutMs);
      timer.unref();
      const finishOpen = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          readyState = 3;
          socket.destroy();
          reject(error);
          return;
        }
        readyState = 1;
        resolve(emitter);
        queueMicrotask(() => emitter.emit('open'));
      };
      const send = (method, params) => {
        if (readyState !== 1 && method !== 'stream.open' && method !== 'stream.close') return;
        socket.write(JSON.stringify({
          id: String(++nextId), token, applicationId, launchId, method, params,
        }) + '\n');
      };
      emitter.OPEN = 1;
      Object.defineProperty(emitter, 'readyState', {get: () => readyState});
      emitter.send = (data, options = {}) => {
        if (readyState !== 1) throw fail('HOST_STREAM_NOT_OPEN');
        const bytes = Buffer.isBuffer(data) || data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(String(data));
        send('stream.send', {streamId, data: bytes.toString('base64'), binary: Boolean(options.binary)});
      };
      emitter.close = () => {
        if (readyState === 3) return;
        readyState = 2;
        if (streamId) send('stream.close', {streamId});
        socket.end();
      };
      const onMessage = (message) => {
        if (message.id === openId) {
          if (!message.ok) return finishOpen(fail(message.error || 'HOST_STREAM_FAILED'));
          streamId = message.value?.streamId;
          if (!streamId) return finishOpen(fail('HOST_STREAM_INVALID'));
          finishOpen();
          return;
        }
        if (message.streamId !== streamId) return;
        if (message.type === 'stream.message') queueMicrotask(() => emitter.emit('message', Buffer.from(message.data || '', 'base64'), Boolean(message.binary)));
        else if (message.type === 'stream.error') queueMicrotask(() => emitter.emit('error', fail('HOST_STREAM_FAILED')));
        else if (message.type === 'stream.close') {
          queueMicrotask(() => {
            readyState = 3;
            emitter.emit('close', Number(message.code) || 1000, Buffer.from(message.reason || '', 'base64'));
            socket.destroy();
          });
        }
      };
      socket.setEncoding('utf8');
      socket.on('connect', () => send('stream.open', {path, headers, protocols}));
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 48 * 1024 * 1024) return finishOpen(fail('HOST_RESPONSE_TOO_LARGE'));
        while (true) {
          const index = buffer.indexOf('\n');
          if (index < 0) break;
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          try { onMessage(JSON.parse(line)); } catch { finishOpen(fail('HOST_INVALID_RESPONSE')); }
        }
      });
      socket.on('error', (error) => {
        if (!settled) finishOpen(fail('HOST_UNAVAILABLE'));
        else emitter.emit('error', error);
      });
      socket.on('close', () => {
        const wasOpen = readyState === 1 || readyState === 2;
        readyState = 3;
        if (!settled) finishOpen(fail('HOST_STREAM_CLOSED'));
        else if (wasOpen) emitter.emit('close', 1006, Buffer.alloc(0));
      });
    });
  }
  return Object.freeze({context, request, openStream, close() { closed = true; }});
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
