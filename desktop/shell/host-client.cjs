const net = require('node:net');
const {EventEmitter} = require('node:events');

function fail(code) { return Object.assign(new Error(code), {code}); }
const MAX_LINE = 48 * 1024 * 1024;

function createHostClient({socketPath, token, applicationId, launchId, timeoutMs = 15000} = {}) {
  if (!socketPath || !token || !applicationId || !launchId) throw fail('HOST_SESSION_MISSING');
  let closed = false, nextId = 0;
  const sockets = new Set();
  // One channel per operation: EOF cancels that operation at the Host.
  function channel(method, params, onEvent = () => {}, onClose = () => {}) {
    if (closed) throw fail('HOST_SESSION_CLOSED');
    const id = String(++nextId), socket = net.createConnection(socketPath);
    sockets.add(socket);
    let buffer = '', settled = false, resolveReply, rejectReply, active = false, pending = [];
    const reply = new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
    const timer = setTimeout(() => abort(fail('HOST_REQUEST_TIMEOUT')), timeoutMs);
    timer.unref();
    const abort = (error) => {
      clearTimeout(timer);
      if (!settled) { settled = true; rejectReply(error); }
      socket.destroy();
    };
    const send = (method, params, messageId = String(++nextId)) => {
      if (socket.destroyed) throw fail('HOST_UNAVAILABLE');
      const line = JSON.stringify({id: messageId, token, applicationId, launchId, method, params}) + '\n';
      if (Buffer.byteLength(line) > MAX_LINE || socket.writableLength > MAX_LINE) throw fail('HOST_REQUEST_TOO_LARGE');
      socket.write(line);
    };
    socket.setEncoding('utf8');
    socket.once('connect', () => { try { send(method, params, id); } catch (error) { abort(error); } });
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) return abort(fail('HOST_RESPONSE_TOO_LARGE'));
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n'), line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { return abort(fail('HOST_INVALID_RESPONSE')); }
        if (message.id === id && !settled) {
          settled = true; clearTimeout(timer);
          if (!message.ok) { rejectReply(fail(message.error || 'HOST_REQUEST_FAILED')); socket.destroy(); }
          else resolveReply(message.value);
        } else {
          // Give the awaiting consumer a chance to install its handlers first.
          queueMicrotask(() => {
            if (!active) pending.push(message); else try { onEvent(message); } catch { abort(fail('HOST_INVALID_RESPONSE')); }
          });
        }
      }
    });
    socket.once('error', () => abort(fail('HOST_UNAVAILABLE')));
    socket.once('close', () => {
      sockets.delete(socket); clearTimeout(timer);
      if (!settled) { settled = true; rejectReply(fail('HOST_UNAVAILABLE')); }
      onClose();
    });
    const activate = () => { active = true; if (pending.length) { const events = pending.splice(0); setImmediate(() => events.forEach((message) => onEvent(message))); } };
    return {reply, socket, send, activate};
  }
  async function context() {
    const transport = channel('context.get');
    try { return await transport.reply; } finally { transport.socket.destroy(); }
  }
  async function request(path, {method = 'GET', body, headers, signal} = {}) {
    if (signal?.aborted) throw fail('HOST_REQUEST_ABORTED');
    const params = {path, method, headers};
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      params.body = Buffer.from(body).toString('base64'); params.bodyEncoding = 'base64';
    } else if (body !== undefined) params.body = body;
    let controller, ended = false;
    const stream = new ReadableStream({
      start(value) { controller = value; },
      pull() { transport.socket.resume(); },
      cancel() { ended = true; transport.socket.destroy(); },
    }, {highWaterMark: 1024 * 1024, size: (chunk) => chunk.byteLength});
    const transport = channel('http.stream', params, (message) => {
      if (ended) return;
      if (message.type === 'http.data') {
        controller.enqueue(Buffer.from(message.data, 'base64'));
        if (controller.desiredSize <= 0) transport.socket.pause();
      } else if (message.type === 'http.end') {
        ended = true; controller.close(); transport.socket.destroy();
      } else if (message.type === 'http.error' || message.ok === false) {
        ended = true; controller.error(fail('HOST_RESPONSE_INTERRUPTED')); transport.socket.destroy();
      }
    }, () => {
      signal?.removeEventListener('abort', cancel);
      if (!ended) { ended = true; controller.error(fail('HOST_UNAVAILABLE')); }
    });
    const cancel = () => transport.socket.destroy();
    signal?.addEventListener('abort', cancel, {once: true});
    try {
      const value = await transport.reply;
      transport.activate();
      if ([204, 205, 304].includes(value.status) || method === 'HEAD') {
        ended = true; controller.close(); transport.socket.destroy();
        return new Response(null, {status: value.status, headers: value.headers});
      }
      return new Response(stream, {status: value.status, headers: value.headers});
    } catch (error) { transport.socket.destroy(); throw error; }
  }
  async function openStream(path, {headers, protocols} = {}) {
    const emitter = new EventEmitter();
    let readyState = 0, streamId;
    emitter.on('error', () => {});
    emitter.OPEN = 1;
    Object.defineProperty(emitter, 'readyState', {get: () => readyState});
    const transport = channel('stream.open', {path, headers, protocols}, (message) => {
      if (message.ok === false || message.type === 'stream.error') {
        emitter.emit('error', fail(message.error || 'HOST_STREAM_FAILED')); transport.socket.destroy();
      } else if (message.streamId === streamId) {
        if (message.type === 'stream.message') emitter.emit('message', Buffer.from(message.data || '', 'base64'), Boolean(message.binary));
        else if (message.type === 'stream.close') {
          readyState = 3; emitter.emit('close', message.code || 1000, Buffer.from(message.reason || '', 'base64')); transport.socket.destroy();
        }
      }
    }, () => {
      if (readyState !== 3) { readyState = 3; emitter.emit('close', 1006, Buffer.alloc(0)); }
    });
    const opened = await transport.reply;
    streamId = opened.streamId;
    if (!streamId) { transport.socket.destroy(); throw fail('HOST_STREAM_INVALID'); }
    readyState = 1;
    emitter.send = (data, options = {}) => {
      if (readyState !== 1) throw fail('HOST_STREAM_NOT_OPEN');
      transport.send('stream.send', {streamId, data: Buffer.from(data).toString('base64'), binary: Boolean(options.binary)});
    };
    emitter.close = () => { if (readyState === 3) return; readyState = 2; transport.socket.destroy(); };
    // The caller installs message handlers only after awaiting openStream().
    setImmediate(transport.activate);
    return emitter;
  }
  return Object.freeze({context, request, openStream, close() { closed = true; for (const socket of sockets) socket.destroy(); }});
}

function fromEnvironment(env = process.env) {
  if (!env.WANX_HOST_SOCKET) return null;
  if (env.WANX_HOST_PROTOCOL_VERSION !== '1') throw fail('HOST_PROTOCOL_UNSUPPORTED');
  return createHostClient({socketPath: env.WANX_HOST_SOCKET, token: env.WANX_HOST_TOKEN,
    applicationId: env.WANX_HOST_CLIENT_APPLICATION_ID, launchId: env.WANX_HOST_LAUNCH_ID});
}
module.exports = {createHostClient, fromEnvironment};
