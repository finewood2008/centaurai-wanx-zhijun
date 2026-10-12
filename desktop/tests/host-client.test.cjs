const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {once} = require('node:events');
const {createHostClient} = require('../shell/host-client.cjs');

test('host client sends fixed application identity and decodes host response', async () => {
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.on('data', data => {
      const request = JSON.parse(data);
      assert.equal(request.applicationId, 'centaurai.wanx.zhijun');
      assert.equal(request.launchId, 'launch-1');
      socket.end(JSON.stringify({id: request.id, ok: true, value: {boxId: 'box-1'}}) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = createHostClient({socketPath: address, token: 'secret', applicationId: 'centaurai.wanx.zhijun', launchId: 'launch-1'});
  assert.deepEqual(await client.context(), {boxId: 'box-1'});
  client.close();
  await new Promise(resolve => server.close(resolve));
});

test('host client keeps the first chat frame delivered with the open response', {timeout: 3000}, async t => {
  const sockets = new Set();
  let resolveSent;
  const sent = new Promise(resolve => { resolveSent = resolve; });
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', data => {
      buffer += data;
      while (true) {
        const index = buffer.indexOf('\n');
        if (index < 0) break;
        const request = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        assert.equal(request.applicationId, 'centaurai.wanx.zhijun');
        assert.equal(request.launchId, 'launch-1');
        if (request.method === 'stream.open') {
          socket.write([
            {id: request.id, ok: true, value: {streamId: 'stream-1'}},
            {type: 'stream.message', streamId: 'stream-1', data: Buffer.from('hello').toString('base64'), binary: false},
          ].map(value => JSON.stringify(value) + '\n').join(''));
        } else if (request.method === 'stream.send') {
          assert.equal(Buffer.from(request.params.data, 'base64').toString(), 'pong');
          resolveSent();
        } else if (request.method === 'stream.close') {
          socket.end();
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = createHostClient({socketPath: address, token: 'secret', applicationId: 'centaurai.wanx.zhijun', launchId: 'launch-1'});
  t.after(async () => {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  const stream = await client.openStream('/api/agents/a/chat/ws');
  const [message] = await once(stream, 'message');
  assert.equal(message.toString(), 'hello');
  stream.send('pong');
  await sent;
  stream.close();
});
