import {access, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createPrivateKey, createPublicKey} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const serverFiles = ['app', 'attachments', 'interaction', 'interaction-schema', 'expert-selection', 'host-client', 'host-runtime', 'knowledge-error', 'library', 'memory', 'ontology', 'policy', 'provision', 'roles', 'static'];

// Stage only the managed application runtime, never the working tree or credentials.
export async function prepareMarketSource(destination, version) {
  await access(path.join(root, 'dist/index.html'));
  const manifest = JSON.parse(await readFile(path.join(root, 'market/wanx-app.json'), 'utf8'));
  if (!version) throw new Error('需要指定市场发行版本。');
  manifest.version = version;
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
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({name:'zhijun-wanx-application', version, private:true, type:'module', dependencies:{ws:ws.version}}, null, 2)+'\n');
  await writeFile(path.join(destination, 'wanx-app.json'), JSON.stringify(manifest, null, 2)+'\n');
}

const optionNames = ['version', 'out', 'os', 'arch', 'key', 'key-id', 'wanx-client'];

export async function readMarketOptions(cli = {}) {
  const configFile = cli.config || path.join(root, 'market-release.local.json');
  const configPath = path.resolve(configFile.startsWith('~/') ? path.join(os.homedir(), configFile.slice(2)) : configFile);
  let config = {};
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || cli.config) throw new Error(`无法读取市场配置 ${configPath}：${error.message}`);
  }
  if (!config || Array.isArray(config) || typeof config !== 'object' ||
      Object.entries(config).some(([key, value]) => !optionNames.includes(key) || typeof value !== 'string' || !value.trim())) {
    throw new Error('市场配置仅支持非空字符串字段：' + optionNames.join(', '));
  }
  const values = {...config, ...cli};
  if (!values.version) throw new Error('请用 --version 指定版本，或在 market-release.local.json 中设置 version；不会读取源码版本。');
  function resolveFile(name, fallback) {
    const value = values[name] || fallback;
    if (value === '~') return os.homedir();
    if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
    return path.resolve(cli[name] ? process.cwd() : path.dirname(configPath), value);
  }
  values['wanx-client'] = resolveFile('wanx-client', path.join(root, '../centuarai-wanx/wanx-client'));
  const {validateVersion} = await import(pathToFileURL(path.join(values['wanx-client'], 'applications/version.mjs')));
  try { validateVersion(values.version); }
  catch { throw new Error('无效的市场版本号，请使用 SemVer，例如 0.4.6。'); }
  values.key = resolveFile('key', path.join(os.homedir(), '.config/wanx-release/release-private.pem'));
  values.out = resolveFile('out', path.join(root, 'delivery/market', values.version));
  values['key-id'] ||= 'release-2026';
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(values['key-id'])) throw new Error('无效的发行 key-id。');
  return values;
}

export async function packageMarket(input = {}) {
  const values = await readMarketOptions(input);
  const targetOS = values.os ?? 'universal', targetArch = values.arch ?? 'universal';
  if (!((targetOS === 'universal' && targetArch === 'universal') ||
    (['macos', 'windows'].includes(targetOS) && ['arm64', 'x64'].includes(targetArch)))) {
    throw new Error('通用应用包请同时省略 --os/--arch，或同时指定 universal；平台专用包必须同时指定 macos/windows 和 arm64/x64。');
  }
  const wanxClient = values['wanx-client'];
  const trusted = JSON.parse(await readFile(path.join(wanxClient, 'applications/market-trust.json'), 'utf8')).keys || {};
  const configured = trusted[values['key-id']];
  if (!configured) throw new Error(`万象客户端未配置信任公钥 ${values['key-id']}。`);
  const privateKey = createPrivateKey(await readFile(values.key));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('签名私钥必须为 Ed25519。');
  const actual = createPublicKey(privateKey).export({type:'spki', format:'der'});
  const expected = createPublicKey(configured).export({type:'spki', format:'der'});
  if (!actual.equals(expected)) throw new Error(`签名私钥与万象客户端 ${values['key-id']} 的公钥不匹配，请先统一发行密钥配置。`);
  const manifest = JSON.parse(await readFile(path.join(root, 'market/wanx-app.json'), 'utf8'));
  const archive = path.join(values.out, `${manifest.applicationId}-${values.version.replaceAll('+', '_')}-${targetOS}-${targetArch}.wanxapp`);
  for (const file of [archive, archive + '.release.json']) {
    try { await access(file); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`产物已存在，不会覆盖：${file}。请指定新版本或输出目录。`);
  }
  const {packageApplication} = await import(pathToFileURL(path.join(wanxClient, 'tools/package-application.mjs')));
  const {verifyEnvelope} = await import(pathToFileURL(path.join(wanxClient, 'applications/descriptor.mjs')));
  const {verifyPackageHash} = await import(pathToFileURL(path.join(wanxClient, 'applications/verified-archive.mjs')));
  console.log(`构建知君市场包 ${values.version}（${targetOS}/${targetArch}）`);
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd:root, stdio:'inherit', shell:process.platform === 'win32',
    env:{...process.env, VITE_ZHIJUN_RELEASE_VERSION:values.version},
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('前端构建失败，未生成市场包。');
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'zhijun-market-'));
  try {
    await prepareMarketSource(sourceDir, values.version);
    const result = await packageApplication({sourceDir, outputDir:values.out, os:targetOS, arch:targetArch, keyFile:values.key, keyId:values['key-id'], minWanxVersion:'0.1.0'});
    const envelope = JSON.parse(await readFile(result.envelopePath, 'utf8'));
    const descriptor = verifyEnvelope(envelope, trusted);
    await verifyPackageHash(result.archivePath, descriptor);
    return result;
  } finally { await rm(sourceDir, {recursive:true, force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options:{...Object.fromEntries([...optionNames, 'config'].map(name => [name, {type:'string'}])), help:{type:'boolean'}}});
    if (values.help) {
      console.log(`用法：npm run package:market -- [--version 0.4.6] [--config ./market-release.local.json]
默认读取项目根目录 market-release.local.json；命令行参数优先。必须显式配置版本。
可选：--out --key --key-id --wanx-client --os --arch
默认：通用包、release-2026、~/.config/wanx-release/release-private.pem、delivery/market/<版本>/。
配置文件中的相对路径相对于配置文件目录；命令行相对路径相对于当前目录。
每次重新构建并验签，不修改源码版本，不覆盖已有包，不上传或发布。`);
    } else {
      const result = await packageMarket(values);
      console.log(JSON.stringify({version:result.descriptor.version, archivePath:result.archivePath, envelopePath:result.envelopePath, sha256:result.descriptor.sha256, verified:true}, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
