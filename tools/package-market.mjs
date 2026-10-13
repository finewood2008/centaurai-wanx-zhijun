import {access, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createPrivateKey, createPublicKey} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const serverFiles = ['app', 'attachments', 'expert-selection', 'host-client', 'host-runtime', 'knowledge-error', 'library', 'memory', 'ontology', 'policy', 'provision', 'roles', 'static'];

// Stage only the managed application runtime, never the working tree or credentials.
export async function prepareMarketSource(destination) {
  await access(path.join(root, 'dist/index.html'));
  const manifest = JSON.parse(await readFile(path.join(root, 'market/wanx-app.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.version) throw new Error('package.json 与市场清单版本不一致。');
  await mkdir(path.join(destination, 'market'), {recursive:true});
  await mkdir(path.join(destination, 'server'), {recursive:true});
  await cp(path.join(root, 'market/main.mjs'), path.join(destination, 'market/main.mjs'));
  for (const name of serverFiles) await cp(path.join(root, `server/${name}.mjs`), path.join(destination, `server/${name}.mjs`));
  await cp(path.join(root, 'server/wanx-host-sdk.cjs'), path.join(destination, 'server/wanx-host-sdk.cjs'));
  await cp(path.join(root, 'dist'), path.join(destination, 'renderer'), {recursive:true});
  await mkdir(path.join(destination, 'resources'), {recursive:true});
  await cp(path.join(root, 'desktop/resources/icon.png'), path.join(destination, 'resources/icon.png'));
  await cp(path.join(root, 'desktop/resources/icon.ico'), path.join(destination, 'resources/icon.ico'));
  await cp(path.join(root, 'desktop/THIRD_PARTY_NOTICES.md'), path.join(destination, 'THIRD_PARTY_NOTICES.md'));
  await mkdir(path.join(destination, 'node_modules'), {recursive:true});
  await cp(path.join(root, 'node_modules/ws'), path.join(destination, 'node_modules/ws'), {recursive:true});
  const ws = JSON.parse(await readFile(path.join(destination, 'node_modules/ws/package.json'), 'utf8'));
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({name:'zhijun-wanx-application', version:pkg.version, private:true, type:'module', dependencies:{ws:ws.version}}, null, 2)+'\n');
  await writeFile(path.join(destination, 'wanx-app.json'), JSON.stringify(manifest, null, 2)+'\n');
}

export async function packageMarket(values) {
  for (const name of ['out', 'key', 'key-id']) if (!values[name]) throw new Error(`缺少 --${name}。`);
  const targetOS = values.os ?? 'universal', targetArch = values.arch ?? 'universal';
  if (!((targetOS === 'universal' && targetArch === 'universal') ||
    (['macos', 'windows'].includes(targetOS) && ['arm64', 'x64'].includes(targetArch)))) {
    throw new Error('通用应用包请同时省略 --os/--arch，或同时指定 universal；平台专用包必须同时指定 macos/windows 和 arm64/x64。');
  }
  const wanxClient = path.resolve(values['wanx-client'] || path.join(root, '../centuarai-wanx/wanx-client'));
  const trusted = JSON.parse(await readFile(path.join(wanxClient, 'applications/market-trust.json'), 'utf8')).keys || {};
  const configured = trusted[values['key-id']];
  if (!configured) throw new Error(`万象客户端未配置信任公钥 ${values['key-id']}。`);
  const actual = createPublicKey(createPrivateKey(await readFile(path.resolve(values.key)))).export({type:'spki', format:'der'});
  const expected = createPublicKey(configured).export({type:'spki', format:'der'});
  if (!actual.equals(expected)) throw new Error(`签名私钥与万象客户端 ${values['key-id']} 的公钥不匹配，请先统一发行密钥配置。`);
  const {packageApplication} = await import(pathToFileURL(path.join(wanxClient, 'tools/package-application.mjs')));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'zhijun-market-'));
  try {
    await prepareMarketSource(sourceDir);
    return await packageApplication({sourceDir, outputDir:path.resolve(values.out), os:targetOS, arch:targetArch, keyFile:path.resolve(values.key), keyId:values['key-id'], minWanxVersion:'0.1.0'});
  } finally { await rm(sourceDir, {recursive:true, force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options:Object.fromEntries(['out', 'os', 'arch', 'key', 'key-id', 'wanx-client'].map(name => [name, {type:'string'}]))});
    const result = await packageMarket(values);
    console.log(JSON.stringify({archivePath:result.archivePath, envelopePath:result.envelopePath}, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
