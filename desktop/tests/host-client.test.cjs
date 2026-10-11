const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
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
