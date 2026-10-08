'use strict';
const I18n = (() => {
  const strings = {
    zh: {
      app: 'Cross-SIM', home: '主页', settings: '设置', pages: '页面', sims: 'SIM 卡', close: '关闭',
      root: '执行权限', rootLabel: 'Root', rootGranted: '模块已授权',
      refresh: '刷新状态', refreshing: '正在刷新…', refreshed: '已刷新', refreshFailed: '刷新失败',
      about: '关于', mode: '运行方式', module: '模块', permissionHint: '由当前 WebUI 宿主提供',
      retry: '重新读取', details: '查看详情', author: '作者', openLinkFailed: '无法打开链接',
      theme: '外观', system: '跟随系统', light: '浅色', dark: '深色', language: '语言',
      reading: '读取中', notRead: '未读取', noSim: '暂无 SIM', simNotRead: '未读取 SIM',
      on: '已开启', off: '已关闭', applying: '处理中', dataSim: '数据卡 · {name}',
      switchLabel: '{name}跨卡通话', viewSettings: '查看设置',
      openInManager: '请用支持模块 WebUI 的宿主打开。Magisk 可配合 KsuWebUI / WebUI X。', bridgeUnsupported: '当前 WebUI 宿主接口不可用，请检查宿主版本与 shell 权限。', invalidArgs: '无效参数', timeout: '请求超时，请重新读取',
      noResult: '没有返回结果', readFailed: '读取失败', incomplete: '系统返回不完整', mismatch: '回读结果不一致'
    },
    en: {
      app: 'Cross-SIM', home: 'Home', settings: 'Settings', pages: 'Pages', sims: 'SIM cards', close: 'Close',
      root: 'Root access', rootLabel: 'Root', rootGranted: 'Granted',
      refresh: 'Refresh status', refreshing: 'Refreshing…', refreshed: 'Updated', refreshFailed: 'Refresh failed',
      about: 'About', mode: 'Mode', module: 'Module', permissionHint: 'Provided by the current WebUI host.',
      retry: 'Read again', details: 'Details', author: 'Author', openLinkFailed: 'Could not open link',
      theme: 'Appearance', system: 'System', light: 'Light', dark: 'Dark', language: 'Language',
      reading: 'Reading', notRead: 'Not read', noSim: 'No SIM', simNotRead: 'SIMs not read',
      on: 'On', off: 'Off', applying: 'Applying', dataSim: 'Data SIM · {name}',
      switchLabel: '{name} — Cross-SIM calling', viewSettings: 'View settings',
      openInManager: 'Open with a compatible module WebUI host. Magisk can use KsuWebUI / WebUI X.', bridgeUnsupported: 'WebUI bridge unavailable. Check the host version and shell permission.', invalidArgs: 'Invalid arguments', timeout: 'Request timed out. Read the state again.',
      noResult: 'No response', readFailed: 'Read failed', incomplete: 'Incomplete system response', mismatch: 'Read-back did not match'
    }
  };
  const read = (key, values) => {
    try {const value=localStorage.getItem('crosssim.'+key);return values.includes(value)?value:'system';}
    catch {return 'system';}
  };
  let theme=read('theme',['system','light','dark']);
  let language=read('language',['system','zh','en']);
  const locale=()=>language==='system'?((navigator.languages?.[0]||navigator.language||'en').toLowerCase().startsWith('zh')?'zh':'en'):language;
  function t(key, values={}) {return (strings[locale()][key]||strings.en[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(values[k]??''));}
  function apply() {
    document.documentElement.style.colorScheme=theme==='system'?'light dark':theme;
    document.documentElement.lang=locale()==='zh'?'zh-CN':'en';
    document.title=t('app');
    document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});
    document.querySelectorAll('[data-i18n-aria]').forEach(node=>node.setAttribute('aria-label',t(node.dataset.i18nAria)));
  }
  function set(key,value) {
    const allowed=key==='theme'?['system','light','dark']:['system','zh','en'];
    if(!allowed.includes(value))return;
    if(key==='theme')theme=value;else language=value;
    try {localStorage.setItem('crosssim.'+key,value);}catch{}
    apply();
  }
  // Apply a saved theme before the first paint. Labels are updated again after DOM parsing.
  document.documentElement.style.colorScheme=theme==='system'?'light dark':theme;
  return {t,apply,set,theme:()=>theme,language:()=>language,locale};
})();
