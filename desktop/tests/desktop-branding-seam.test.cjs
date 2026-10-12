const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');

for(const [mode,hostLaunch,hasDock] of [
 ['WANX hosted macOS','fixture-launch',true],
 ['standalone macOS',undefined,true],
 ['platform without Dock','fixture-launch',false],
]){
 test(`${mode} uses ZhiJun branding at the Electron boundary`,async()=>{
  const shell=path.join(__dirname,'../shell');
  const source=await readFile(path.join(shell,'main.cjs'),'utf8');
  const icons=[],windows=[],errors=[];
  let ready;
  const readiness=new Promise(resolve=>{ready=resolve;});
  const app=Object.assign(new EventEmitter(),{
   isPackaged:true,getPath:()=>path.join(__dirname,'fixture-profile'),setPath(){},
   requestSingleInstanceLock:()=>true,whenReady:()=>readiness,quit(){},
   ...(hasDock?{dock:{setIcon:icon=>icons.push(icon)}}:{}),
  });
  class BrowserWindow{
   constructor(options){
    windows.push(options);
    this.webContents=Object.assign(new EventEmitter(),{
     setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},
    });
   }
   async loadURL(url){assert.equal(url,'http://127.0.0.1:12345/');}
  }
  const electron={app,BrowserWindow,Menu:{buildFromTemplate:items=>items,setApplicationMenu(){}},safeStorage:{},dialog:{showErrorBox:(...args)=>errors.push(args)}};
  vm.runInNewContext(source,{
   __dirname:shell,process:{env:hostLaunch?{WANX_HOST_LAUNCH_ID:hostLaunch}:{}},
   require(name){
    if(name==='electron')return electron;
    if(name==='node:path')return path;
    if(name==='./runtime.cjs')return {startDesktopRuntime:async()=>({origin:'http://127.0.0.1:12345',close(){}})};
    throw Error(`Unexpected dependency: ${name}`);
   },
  },{filename:path.join(shell,'main.cjs')});
  assert.deepEqual(icons,[],'Dock must not be touched before Electron is ready');
  ready();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(errors,[]);
  assert.equal(windows.length,1);
  assert.equal(windows[0].title,'知君');
  const icon=path.join(shell,'../resources/icon.png');
  assert.equal(windows[0].icon,icon);
  assert.deepEqual(icons,hasDock?[icon]:[],'Dock must use the application icon instead of the Host executable icon');
  const bytes=await readFile(icon);
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 });
}
