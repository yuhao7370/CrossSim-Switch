const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('module/webroot/app.js','utf8');
const translations=fs.readFileSync('module/webroot/i18n.js','utf8');
class Node {
  constructor(id=''){this.id=id;this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.style={};this.children=[];this.nodes={};this.attrs={};this.classes=new Set();this.classList={toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};}
  querySelector(key){return this.nodes[key] ||= new Node();}
  appendChild(n){this.children.push(n);n.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  setAttribute(k,v){this.attrs[k]=v;}
  focus(){this.focused=true;if(this.ownerDocument)this.ownerDocument.activeElement=this;}
  replaceChildren(){for(const n of this.children)n.parent=null;this.children=[];}
  cloneNode(){return new Node();}
}
function fixture(options={}){
  const nodes={},pending=[],events={},timers=new Map();let nextTimer=1;
  const storage=new Map(Object.entries(options.storage||{}));
  const navigator={language:options.systemLanguage||'zh-CN',languages:[options.systemLanguage||'zh-CN']};
  const document={hidden:false,documentElement:new Node(),getElementById(id){const n=nodes[id] ||= new Node(id);n.ownerDocument=document;return n;},
    createElement(tag){const n=new Node();n.tagName=tag.toUpperCase();n.ownerDocument=document;return n;},
    querySelectorAll(selector){return selector==='.page'?['home','preferences','permission','info'].map(id=>document.getElementById(id)):selector==='[data-tab]'?['home','preferences'].map(id=>document.getElementById('tab-'+id)):[];},
    addEventListener(name,fn){events[name]=fn;}};
  document.getElementById('cards');
  for(const page of ['home','preferences'])document.getElementById('tab-'+page).dataset.tab=page;
  document.getElementById('card-template').content={firstElementChild:new Node()};
  const entries=[null];let cursor=0;
  const history={get state(){return entries[cursor];},get length(){return entries.length;},
    replaceState(s){entries[cursor]=s;},pushState(s){entries.splice(cursor+1);entries.push(s);cursor++;},
    go(delta){const next=cursor+delta;if(next<0||next>=entries.length)return;cursor=next;events['window:popstate']?.({state:entries[cursor]});},
    back(){this.go(-1);}};
  const context=vm.createContext({document,navigator,history,Date,Math,console,scrollTo(){},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    addEventListener(name,fn){events['window:'+name]=fn;},
    setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){},
    HostBridge:{exec(command){return new Promise(resolve=>pending.push({command,resolve}));}}});
  context.window=context;vm.runInContext(translations,context);vm.runInContext(source,context);
  async function reply(sims,override){const req=pending.shift();assert.ok(req);req.resolve({code:0,stdout:'CROSSSIM_RESULT:'+JSON.stringify(override || {ok:true,uid:0,sims}),stderr:''});await new Promise(resolve=>setImmediate(resolve));return req;}
  const card=id=>nodes.cards.children.find(c=>Number(c.querySelector('.switch').dataset.id)===id);
  return{context,nodes,pending,document,events,reply,card,storage,navigator,history,timers};
}
function choose(f,key,value){
  f.nodes['tab-preferences'].onclick();f.nodes[key].onclick({detail:1});
  const option=f.nodes['picker-options'].children.find(b=>b.dataset.value===value);
  assert.ok(option);option.onclick();
}
const cn={id:2,slot:0,name:'中国联通',data:true,enabled:false};
const tw={id:9,slot:1,name:'台湾大哥大',data:false,enabled:true};
const hk={id:12,slot:1,name:'香港卡',data:false,enabled:false};

test('module reads both real SIM cards without requesting APK root',async()=>{
  const f=fixture();assert.match(f.pending[0].command,/control\.sh list$/);assert.doesNotMatch(f.pending[0].command,/\bsu\b/);
  await f.reply([cn,tw]);assert.equal(f.nodes.cards.children.length,2);
  assert.equal(f.card(9).querySelector('.name').textContent,'台湾大哥大');
  assert.equal(f.card(9).querySelector('.slot-label').textContent,'SIM 2');
  assert.equal(f.card(9).querySelector('.status').textContent,'已开启');
  assert.equal(f.nodes['root-state'].textContent,'模块已授权');
});
test('profile removal and replacement discard the old card; write uses new ID',async()=>{
  const f=fixture();await f.reply([cn,tw]);
  f.nodes.refresh.onclick();await f.reply([cn]);assert.equal(f.card(9),undefined);
  f.nodes.refresh.onclick();await f.reply([cn,hk]);
  f.card(12).querySelector('.switch').onclick();assert.match(f.pending[0].command,/ on 12 1$/);
  assert.equal(f.card(12).querySelector('.status').textContent,'处理中');
  assert.equal(f.card(12).querySelector('.switch').attrs['aria-checked'],'false');
  await f.reply(null,{ok:true,subId:12,enabled:true});
  assert.equal(f.card(12).querySelector('.status').textContent,'已开启');
  assert.ok(f.card(12).classes.has('active'));
});
test('late read after backgrounding is discarded, returning while busy queues a fresh read',async()=>{
  const f=fixture();f.document.hidden=true;f.events.visibilitychange();f.document.hidden=false;f.events.visibilitychange();
  await f.reply([cn,tw]);assert.equal(f.nodes.cards.children.length,0);assert.equal(f.pending.length,1);
  await f.reply([cn,hk]);assert.equal(f.card(9),undefined);assert.ok(f.card(12));
});
test('rejected write never displays success and disables the unknown target',async()=>{
  const f=fixture();await f.reply([cn,hk]);f.card(12).querySelector('.switch').onclick();
  await f.reply(null,{ok:false,error:'SIM changed'});
  assert.equal(f.card(12).querySelector('.status').textContent,'未读取');
  assert.equal(f.card(12).querySelector('.switch').disabled,true);
  assert.equal(f.nodes['error-detail'].textContent,'SIM changed');
});
test('no SIM and unknown switch are truthful; names are plain text',async()=>{
  const f=fixture();await f.reply([]);assert.equal(f.nodes.empty.textContent,'暂无 SIM');
  f.nodes.refresh.onclick();await f.reply([{id:15,slot:1,name:'<img src=x>',data:false}]);
  assert.equal(f.card(15).querySelector('.name').textContent,'<img src=x>');
  assert.equal(f.card(15).querySelector('.status').textContent,'未读取');assert.equal(f.card(15).querySelector('.switch').disabled,true);
});
test('moving an existing subscription to another slot updates the card order and write target',async()=>{
  const f=fixture();await f.reply([cn,tw]);
  f.nodes.refresh.onclick();await f.reply([{...tw,slot:0},{...cn,slot:1}]);
  assert.equal(f.card(9).style.order,0);assert.equal(f.card(2).style.order,1);
  f.card(9).querySelector('.switch').onclick();assert.match(f.pending[0].command,/ off 9 0$/);
  await f.reply(null,{ok:true,subId:9,enabled:false});
});
test('bottom tabs cover settings subpages and preserve cards without root writes',async()=>{
  const f=fixture();await f.reply([cn,tw]);const original=f.card(9);
  f.nodes['tab-preferences'].onclick();
  assert.equal(f.nodes.home.hidden,true);assert.equal(f.nodes.preferences.hidden,false);
  assert.equal(f.nodes['settings-panel'].hidden,false);assert.equal(f.nodes['bottom-nav'].dataset.page,'preferences');
  assert.equal(f.nodes['tab-preferences'].attrs['aria-selected'],'true');
  f.nodes.root.onclick();assert.equal(f.nodes.permission.hidden,false);
  f.nodes['tab-preferences'].onclick();assert.equal(f.nodes.permission.hidden,true);assert.equal(f.nodes.preferences.hidden,false);
  f.nodes['tab-home'].onclick();assert.equal(f.nodes.home.hidden,false);assert.equal(f.nodes['settings-panel'].hidden,true);
  assert.equal(f.card(9),original);assert.equal(f.pending.length,0);
});
test('tab keyboard navigation updates focus and selected state',async()=>{
  const f=fixture();await f.reply([cn,tw]);let prevented=false;
  f.nodes['tab-home'].onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(f.nodes['tab-preferences'].focused,true);
  assert.equal(f.nodes['bottom-nav'].dataset.page,'preferences');
});
test('manual refresh executes a new read and visibly reports progress and completion',async()=>{
  const f=fixture();await f.reply([cn,{...tw,enabled:false}]);
  f.nodes.refresh.onclick();assert.match(f.pending[0].command,/ list$/);
  assert.equal(f.nodes['refresh-label'].textContent,'正在刷新…');
  assert.ok(f.nodes['refresh-icon'].classes.has('spinning'));
  await f.reply([cn,tw]);
  assert.equal(f.card(9).querySelector('.status').textContent,'已开启');
  assert.equal(f.nodes['refresh-label'].textContent,'刷新状态');
  assert.equal(f.nodes.toast.textContent,'已刷新');assert.ok(f.nodes.toast.classes.has('show'));
});
test('manual refresh queued behind automatic reading waits for its own result',async()=>{
  const f=fixture();f.nodes.refresh.onclick();await f.reply([cn,tw]);
  assert.equal(f.pending.length,1);assert.equal(f.nodes.toast?.textContent||'','');
  await f.reply([cn,hk]);assert.equal(f.nodes.toast.textContent,'已刷新');
});
test('refresh failure gives explicit feedback and keeps uncertain switches disabled',async()=>{
  const f=fixture();await f.reply([cn,tw]);f.nodes.refresh.onclick();
  await f.reply(null,{ok:false,error:'backend failed'});
  assert.equal(f.nodes.toast.textContent,'刷新失败');assert.equal(f.card(9).querySelector('.switch').disabled,true);
});
test('appearance and English persist without changing SIM names or invoking root',async()=>{
  const f=fixture();await f.reply([cn,tw]);
  choose(f,'theme','dark');
  assert.equal(f.document.documentElement.style.colorScheme,'dark');
  choose(f,'language','en');
  assert.equal(f.document.documentElement.lang,'en');assert.equal(f.document.title,'Cross-SIM');
  assert.equal(f.card(9).querySelector('.name').textContent,'台湾大哥大');
  assert.equal(f.card(9).querySelector('.status').textContent,'On');
  assert.equal(f.nodes['refresh-label'].textContent,'Refresh status');assert.equal(f.pending.length,0);
  const restored=fixture({storage:Object.fromEntries(f.storage)});await restored.reply([cn,tw]);
  assert.equal(restored.document.documentElement.style.colorScheme,'dark');assert.equal(restored.document.documentElement.lang,'en');
});
test('system appearance and system language follow platform preferences',async()=>{
  const f=fixture();await f.reply([cn,tw]);
  assert.equal(f.document.documentElement.style.colorScheme,'light dark');
  f.navigator.languages=['en-US'];f.events['window:languagechange']();
  assert.equal(f.document.documentElement.lang,'en');assert.equal(f.card(9).querySelector('.status').textContent,'On');
  choose(f,'theme','light');assert.equal(f.document.documentElement.style.colorScheme,'light');
  choose(f,'theme','system');assert.equal(f.document.documentElement.style.colorScheme,'light dark');
});
test('system back closes the in-page picker, then returns from details to Settings and Home',async()=>{
  const f=fixture();await f.reply([cn,tw]);f.nodes['tab-preferences'].onclick();f.nodes.theme.onclick({detail:1});
  assert.equal(f.nodes.picker.hidden,false);assert.equal(f.nodes.app.inert,true);assert.equal(f.history.state.picker,'theme');
  f.history.back();assert.equal(f.nodes.picker.hidden,true);assert.equal(f.nodes.app.inert,false);assert.equal(f.nodes.preferences.hidden,false);
  f.nodes.root.onclick();assert.equal(f.nodes.permission.hidden,false);
  f.history.back();assert.equal(f.nodes.permission.hidden,true);assert.equal(f.nodes.preferences.hidden,false);
  f.history.back();assert.equal(f.nodes.home.hidden,false);assert.equal(f.history.state.depth,0);
});
test('quick refresh keeps the indicator rotating for a complete feedback cycle',async()=>{
  const f=fixture();await f.reply([cn,tw]);f.nodes.refresh.onclick();await f.reply([cn,tw]);
  assert.ok(f.nodes['refresh-icon'].classes.has('spinning'));assert.equal(f.nodes.toast.textContent,'已刷新');
  f.nodes['refresh-icon'].onanimationiteration({animationName:'spin'});
  assert.equal(f.nodes['refresh-icon'].classes.has('spinning'),false);
});
