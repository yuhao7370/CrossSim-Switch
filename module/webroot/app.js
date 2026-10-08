'use strict';
const el = id => document.getElementById(id);
const t = I18n.t;
const cards = new Map();
let sims = [], busy = false, generation = 0, pendingRefresh = false, rootReady = false, error = '';
let activePage = '';
let manualActive = false, pendingManual = false, toastTimer, toastKey = '';
let spinnerActive = false, spinnerTimer, activePicker = null, pickerKeyboard = false;
let openingAuthor = false;
const moduleDir = '/data/adb/modules/crosssim_switch';

async function execute(args) {
  if (!['list','on','off'].includes(args[0]) || args.slice(1).some(n => !Number.isInteger(n) || n < 0)) throw new Error(t('invalidArgs'));
  let result;
  try {result=await HostBridge.exec('/system/bin/sh '+moduleDir+'/control.sh '+args.join(' '));}
  catch(error) {
    const keys={BRIDGE_MISSING:'openInManager',BRIDGE_UNSUPPORTED:'bridgeUnsupported',BRIDGE_TIMEOUT:'timeout',BRIDGE_INVALID_RESULT:'noResult'};
    if(keys[error.code])throw new Error(t(keys[error.code])+(error.detail?'\n'+error.detail:''));
    throw error;
  }
  const line=result.stdout.split(/\r?\n/).find(s=>s.startsWith('CROSSSIM_RESULT:'));
  if(!line)throw new Error(result.stderr||result.stdout||t('noResult'));
  const data=JSON.parse(line.slice(16));
  if(data.uid===0)rootReady=true;
  if(!data.ok || (result.code!==null && result.code!==0))throw new Error(data.error||t('readFailed'));
  return data;
}

function render() {
  const active = new Set(sims.map(s => s.id));
  for (const [id, card] of cards) if (!active.has(id)) {card.remove();cards.delete(id);}
  for (const sim of sims) {
    let card = cards.get(sim.id);
    if (!card) {
      card = el('card-template').content.firstElementChild.cloneNode(true);
      cards.set(sim.id,card);el('cards').appendChild(card);
      card.querySelector('.switch').onclick = () => change(sim.id);
    }
    const valid = typeof sim.enabled === 'boolean';
    card.style.order = sim.slot;
    card.classList.toggle('active',valid && sim.enabled);
    card.classList.toggle('unknown',!valid);
    card.querySelector('.slot-label').textContent = 'SIM ' + (sim.slot+1);
    card.querySelector('.name').textContent = sim.name || 'SIM '+(sim.slot+1);
    card.querySelector('.status').textContent = t(sim.pending ? 'applying' : valid ? (sim.enabled?'on':'off') : 'notRead');
    const toggle = card.querySelector('.switch');
    toggle.setAttribute('aria-label',t('switchLabel',{name:sim.name || 'SIM '+(sim.slot+1)}));
    toggle.setAttribute('aria-checked', String(valid && sim.enabled));
    toggle.disabled = busy || !valid;
    toggle.dataset.id = sim.id;
  }
  el('empty').hidden = sims.length > 0;
  el('empty').textContent = t(busy ? 'reading' : error ? 'simNotRead' : 'noSim');
  const data = sims.find(s=>s.data);
  el('data').textContent = data ? t('dataSim',{name:data.name}) : '';
  el('root-state').textContent = el('permission-state').textContent = t(rootReady ? 'rootGranted' : busy ? 'reading' : 'notRead');
  el('error-link').hidden = !error;
  el('diagnostics').hidden = !error;
  el('error-detail').textContent = error;
  el('refresh').disabled = manualActive || pendingManual;el('retry').disabled = manualActive || pendingManual;
  el('refresh-label').textContent = t(manualActive || pendingManual ? 'refreshing' : 'refresh');
  el('refresh-icon').classList.toggle('spinning',manualActive || pendingManual || spinnerActive);
}
function finish() {
  busy=false;manualActive=false;render();
  if (pendingRefresh && !document.hidden) {
    const manual=pendingManual;pendingRefresh=false;pendingManual=false;refresh(manual);
  }
}
function toast(key) {
  clearTimeout(toastTimer);toastKey=key;
  el('toast').textContent=t(key);el('toast').classList.toggle('show',true);
  toastTimer=setTimeout(()=>el('toast').classList.toggle('show',false),2400);
}
async function refresh(manual=false) {
  if (document.hidden) return;
  if (manual) {
    spinnerActive=true;clearTimeout(spinnerTimer);
    // The native bridge can block JS briefly; count a real CSS iteration, not IPC time.
    spinnerTimer=setTimeout(()=>{
      if(document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          || (el('refresh-icon').getClientRects && !el('refresh-icon').getClientRects().length)) {
        spinnerActive=false;render();
      }
    },2000);
  }
  if (busy) {pendingRefresh=true;pendingManual=pendingManual||manual;render();return;}
  busy=true;manualActive=manual;const token=++generation;render();
  try {
    const result=await execute(['list']);
    if (token!==generation || document.hidden) return;
    if (!Array.isArray(result.sims)) throw new Error(t('incomplete'));
    sims=result.sims.filter(s=>Number.isInteger(s.id)&&s.id>=0&&Number.isInteger(s.slot)&&s.slot>=0).sort((a,b)=>a.slot-b.slot);
    error='';
    if (typeof result.animationsEnabled === 'boolean') document.documentElement.classList.toggle('reduce-motion',!result.animationsEnabled);
    if(manual)toast('refreshed');
  } catch(e) {
    if(token===generation) {for(const sim of sims)delete sim.enabled;error=e.message;if(manual)toast('refreshFailed');}
  } finally {finish();}
}
async function change(id) {
  const sim=sims.find(s=>s.id===id);
  if(busy || !sim || typeof sim.enabled!=='boolean' || document.hidden)return;
  const desired=!sim.enabled,token=++generation;
  busy=true;sim.pending=true;render();
  try {
    const result=await execute([desired?'on':'off',sim.id,sim.slot]);
    if(token!==generation || document.hidden)return;
    if(result.subId!==sim.id || result.enabled!==desired)throw new Error(t('mismatch'));
    sim.enabled=result.enabled;error='';
  } catch(e) {if(token===generation){delete sim.enabled;error=e.message;}}
  finally {delete sim.pending;finish();}
}
function renderPage(page,animate=true) {
  if (!['home','preferences','permission','info'].includes(page) || page === activePage) return;
  const back = page === 'home' || (activePage !== 'home' && page === 'preferences');
  for(const section of document.querySelectorAll('.page')) {
    const showing=section.id===page;section.hidden=!showing;
    section.classList.toggle('enter',showing && animate);section.classList.toggle('backwards',back);
  }
  activePage = page;
  const tab = page === 'home' ? 'home' : 'preferences';
  el('settings-panel').hidden = tab === 'home';
  el('bottom-nav').dataset.page = tab;
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  window.scrollTo({top:0,behavior:'instant'});
}
const routeFor=(page,picker=null)=>({crosssim:1,page,picker,depth:(page==='home'?0:page==='preferences'?1:2)+(picker?1:0)});
const validRoute=r=>r?.crosssim===1 && ['home','preferences','permission','info'].includes(r.page)
  && (!r.picker || (r.page==='preferences' && ['theme','language'].includes(r.picker)));
function renderPicker() {
  el('picker').hidden=!activePicker;
  el('app').inert=!!activePicker;el('bottom-nav').inert=!!activePicker;
  if(!activePicker)return;
  el('picker-title').textContent=t(activePicker);
  const options=activePicker==='theme'
    ? [['system',t('system')],['light',t('light')],['dark',t('dark')]]
    : [['system',t('system')],['zh','简体中文'],['en','English']];
  const selected=activePicker==='theme'?I18n.theme():I18n.language();
  const container=el('picker-options');container.replaceChildren();
  let focused;
  for(const [value,label] of options) {
    const button=document.createElement('button');button.type='button';button.className='picker-option';
    button.dataset.value=value;button.setAttribute('role','radio');button.setAttribute('aria-checked',String(value===selected));
    const text=document.createElement('span');text.textContent=label;
    const check=document.createElement('span');check.className='ui-icon icon-check';check.setAttribute('aria-hidden','true');
    button.appendChild(text);button.appendChild(check);button.onclick=()=>choosePreference(value);container.appendChild(button);
    if(value===selected)focused=button;
  }
  if(pickerKeyboard)focused?.focus({preventScroll:true});
}
function renderRoute(route,animate=true) {
  const previousPicker=activePicker;
  renderPage(route.page,animate);activePicker=route.picker||null;renderPicker();
  if(previousPicker && !activePicker && pickerKeyboard)el(previousPicker).focus({preventScroll:true});
}
function navigate(page,animate=true) {
  if(!['home','preferences','permission','info'].includes(page))return;
  const next=routeFor(page),current=validRoute(history.state)?history.state:routeFor('home');
  if(next.depth<current.depth){history.go(next.depth-current.depth);return;}
  if(page===activePage && !activePicker)return;
  if(next.depth===current.depth)history.replaceState(next,'');else history.pushState(next,'');
  renderRoute(next,animate);
}
function openPicker(key,keyboard=false) {
  if(activePage!=='preferences')return;
  pickerKeyboard=keyboard;
  const route=routeFor('preferences',key);history.pushState(route,'');renderRoute(route,false);
}
function dismissPicker(){if(activePicker)history.back();}
function choosePreference(value) {
  if(!activePicker)return;
  I18n.set(activePicker,value);applyPreferences();history.back();
}
window.addEventListener('popstate',e=>renderRoute(validRoute(e.state)?e.state:routeFor('home')));
document.querySelectorAll('[data-tab]').forEach(b=>{
  b.onclick=()=>navigate(b.dataset.tab);
  b.onkeydown=e=>{
    if (e.key!=='ArrowLeft' && e.key!=='ArrowRight') return;
    e.preventDefault();
    const tab=e.key==='ArrowLeft'?'home':'preferences';
    navigate(tab);el('tab-'+tab).focus();
  };
});
el('error-link').onclick=()=>navigate('preferences');
el('root').onclick=()=>navigate('permission');
el('about').onclick=()=>navigate('info');
el('author').onclick=async event=>{
  // Keep the module's route intact: root WebUI hosts launch the external URL via Android.
  if (!['ksu','kernelsu'].some(name=>typeof window[name]?.exec==='function')) return;
  event.preventDefault();
  if (openingAuthor) return;
  openingAuthor=true;
  try {
    const result=await HostBridge.exec("/system/bin/am start --user current -a android.intent.action.VIEW -d 'https://github.com/yuhao7370'");
    if ((result.code!==null && result.code!==0) || /Error:|Exception|unable to resolve Intent/i.test(result.stderr+'\n'+result.stdout)) throw new Error();
  } catch {toast('openLinkFailed');}
  finally {openingAuthor=false;}
};
el('refresh').onclick=()=>refresh(true);el('retry').onclick=()=>refresh(true);
el('refresh-icon').onanimationiteration=e=>{
  if(e.animationName==='spin' && !manualActive && !pendingManual){spinnerActive=false;clearTimeout(spinnerTimer);render();}
};
function applyPreferences() {
  I18n.apply();el('theme-value').textContent=t(I18n.theme());
  el('language-value').textContent=I18n.language()==='system'?t('system'):I18n.language()==='zh'?'简体中文':'English';
  render();
  if(toastKey)el('toast').textContent=t(toastKey);
}
el('theme').onclick=e=>openPicker('theme',e?.detail===0);
el('language').onclick=e=>openPicker('language',e?.detail===0);
el('picker-close').onclick=dismissPicker;
el('picker').onkeydown=e=>{
  if(e.key==='Escape'){e.preventDefault();dismissPicker();return;}
  if(!['Tab','ArrowUp','ArrowDown'].includes(e.key))return;
  const buttons=[...el('picker-options').children];
  const index=buttons.indexOf(document.activeElement);
  const direction=e.key==='ArrowUp'||(e.key==='Tab'&&e.shiftKey)?-1:1;
  const next=(index+direction+buttons.length)%buttons.length;
  e.preventDefault();buttons[next]?.focus();
};
window.addEventListener('languagechange',applyPreferences);
document.addEventListener('visibilitychange',()=>{generation++;if(!document.hidden)refresh();});
setInterval(()=>{if(!busy)refresh();},5000);
history.scrollRestoration='manual';
const initialRoute=validRoute(history.state)?history.state:routeFor('home');
history.replaceState(initialRoute,'');applyPreferences();renderRoute(initialRoute,false);
refresh();
