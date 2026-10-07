/*!
 * Leo 站点 · 主页内容配置（可拓展） + 可视化编辑器
 * ---------------------------------------------------------------------------
 * 数据优先级：本地保存(localStorage) > assets/data/site.json(可选) > 内置默认
 * 提供：LEOSite.get()/load()/save()/reset()/exportJSON()/importJSON()/mountEditor()
 * 主页(index.html) 与 管理中心(admin/index.html) 共用本模块；编辑器对所有人公开。
 */
(function (global) {
  'use strict';

  var KEY = 'leoljs.site.v1';
  var FILE = 'assets/data/site.json';
  /* 站点根路径：本脚本位于 <根>/assets/js/ 下 */
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || (function () {
    var list = document.getElementsByTagName('script');
    for (var i = list.length - 1; i >= 0; i--) {
      if (/assets\/js\/leo-site\.js(\?|#|$)/.test(list[i].src || '')) return list[i].src;
    }
    return location.href;
  })();
  var ROOT;
  try { ROOT = new URL('../../', SCRIPT_URL).href; } catch (e) { ROOT = './'; }

  /* ======================== 默认内容（可被本地保存覆盖） ======================== */
  var DEFAULT_SITE = {
    version: 1,
    brand: { name: 'Leo 的网页小站', logo: 'L' },
    hero: {
      tagline: '小游戏 · 音乐 · 持续扩充中',
      title: '欢迎来到我的网页小站',
      subtitle: '这里收录了自己整理的网页小游戏与音乐播放器。游戏中心会自动收录 game 目录下的所有子文件夹，音乐播放器会扫描 music 目录中的音频文件；所有页面都可以直接打开，站点内容也能在页面上可视化编辑。',
      primaryText: '进入游戏中心',
      primaryHref: 'game/',
      secondaryText: '打开音乐播放器',
      secondaryHref: 'music/'
    },
    nav: [
      { label: '主页', href: './' },
      { label: '游戏中心', href: 'game/' },
      { label: '音乐播放器', href: 'music/' },
      { label: '管理中心', href: 'admin/' }
    ],
    announcement: {
      enabled: true,
      title: '站点公告',
      text: '站点处于持续建设中：新增的网页游戏只要放进 game 目录下的子文件夹，即可在游戏中心被收录。'
    },
    blocks: [
      {
        id: 'games', kind: 'games', enabled: true, icon: '游',
        title: '游戏中心', href: 'game/',
        desc: '收录 game 目录下的全部网页小游戏，支持搜索、标签筛选、收藏与可视化编辑。'
      },
      {
        id: 'music', kind: 'music', enabled: true, icon: '乐',
        title: '音乐播放器', href: 'music/',
        desc: '内置唱片机风格的播放器，自动扫描 music 目录中的音频文件，支持随机、循环与音量记忆。'
      },
      {
        id: 'admin', kind: 'link', enabled: true, icon: '管',
        title: '管理中心', href: 'admin/',
        desc: '查看站点状态与游戏目录；站点的内容与目录都可以在这里可视化编辑。'
      }
    ],
    sections: [
      {
        id: 'extend', enabled: true, title: '更多功能（可拓展）',
        text: '主页的板块、导航与公告都可以在编辑模式下自由增删改；任何新网页只要放到对应目录，再添加一个入口板块即可对外展示。'
      }
    ],
    footer: {
      text: 'Leo 的网页小站 · 纯静态站点，内容配置保存在浏览器本地',
      links: [
        { label: '游戏中心', href: 'game/' },
        { label: '音乐播放器', href: 'music/' },
        { label: '管理中心', href: 'admin/' }
      ]
    }
  };
  /* ======================== 工具 ======================== */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function readStore() {
    try {
      var raw = global.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeStore(cfg) {
    try { global.localStorage.setItem(KEY, JSON.stringify(cfg)); return true; }
    catch (e) { return false; }
  }
  /* 顶层浅合并：数组整体替换，便于编辑器直接呈现完整配置 */
  function merge(base, over) {
    var out = clone(base);
    if (!over || typeof over !== 'object') return out;
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = merge(out[k], v);
      } else if (v !== undefined && v !== null) {
        out[k] = clone(v);
      }
    });
    return out;
  }
  function normalize(cfg) {
    var c = merge(DEFAULT_SITE, cfg);
    if (!Array.isArray(c.nav)) c.nav = clone(DEFAULT_SITE.nav);
    if (!Array.isArray(c.blocks)) c.blocks = clone(DEFAULT_SITE.blocks);
    if (!Array.isArray(c.sections)) c.sections = [];
    if (!c.footer || !Array.isArray(c.footer.links)) c.footer = merge(DEFAULT_SITE.footer, c.footer);
    c.blocks.forEach(function (b) {
      if (!b.id) b.id = uid('blk');
      if (b.enabled == null) b.enabled = true;
      if (!b.kind) b.kind = 'link';
    });
    c.sections.forEach(function (s) { if (!s.id) s.id = uid('sec'); if (s.enabled == null) s.enabled = true; });
    return c;
  }

  /* ======================== 载入 / 保存 ======================== */
  var cache = null;
  var source = 'default';
  var listeners = [];

  function get() { return cache || (cache = normalize(readStore())); }
  function load() {
    var stored = readStore();
    if (stored) { cache = normalize(stored); source = 'local'; return Promise.resolve(get()); }
    if (!/^https?:$/.test(location.protocol) || typeof global.fetch !== 'function') {
      cache = normalize(null); source = 'default'; return Promise.resolve(get());
    }
    return global.fetch(new URL(FILE, ROOT).href, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (data && typeof data === 'object') { cache = normalize(data); source = 'file'; }
        else { cache = normalize(null); source = 'default'; }
        return get();
      });
  }
  function emit() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    try { document.dispatchEvent(new CustomEvent('leosite:change', { detail: { config: get(), source: source } })); }
    catch (e) { /* ignore */ }
  }
  function save(cfg) {
    cache = normalize(cfg);
    var ok = writeStore(JSON.stringify(cache));
    if (ok) source = 'local';
    emit();
    return { ok: ok, config: get() };
  }
  function reset() {
    try { global.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    cache = normalize(null);
    source = 'default';
    emit();
    return get();
  }
  function exportJSON() { return JSON.stringify(normalize(cache || get()), null, 2); }
  function importJSON(text) {
    var data;
    try { data = JSON.parse(String(text || '')); }
    catch (e) { return { ok: false, error: 'JSON 解析失败：' + e.message }; }
    if (!data || typeof data !== 'object') return { ok: false, error: 'JSON 内容无效' };
    return { ok: true, config: save(data).config };
  }
  function sourceLabel() {
    return { local: '浏览器本地保存', file: FILE, default: '内置默认' }[source] || source;
  }
  /* ======================== 编辑器 工具 ======================== */
  function download(filename, text) {
    var blob = new Blob([String(text)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function setPath(obj, path, value) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (cur[k] == null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }
  function collect(host, cfg) {
    if (!host) return cfg;
    var list = host.querySelectorAll('[data-path]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var v = (el.type === 'checkbox') ? !!el.checked : el.value;
      setPath(cfg, el.getAttribute('data-path'), v);
    }
    return cfg;
  }
  function fText(label, path, value, ph) {
    return '<div class="leo-field"><label>' + esc(label) + '</label>' +
      '<input class="leo-input" data-path="' + esc(path) + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '"></div>';
  }
  function fArea(label, path, value, rows) {
    return '<div class="leo-field"><label>' + esc(label) + '</label>' +
      '<textarea class="leo-textarea" rows="' + (rows || 3) + '" data-path="' + esc(path) + '">' + esc(value) + '</textarea></div>';
  }
  function fCheck(label, path, checked) {
    return '<label class="leo-check" style="margin-bottom:12px"><input type="checkbox" data-path="' + esc(path) + '"' +
      (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
  }
  function fSelect(label, path, value, options) {
    var opts = options.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    return '<div class="leo-field"><label>' + esc(label) + '</label>' +
      '<select class="leo-select" data-path="' + esc(path) + '">' + opts + '</select></div>';
  }
  var KIND_OPTIONS = [
    { v: 'games', label: '游戏板块（自动统计游戏数量）' },
    { v: 'music', label: '音乐板块' },
    { v: 'link', label: '普通链接板块' },
    { v: 'note', label: '纯说明板块（不可点击）' }
  ];
  function opsBtns(group, idx, total) {
    return '<div class="ops">' +
      '<button class="leo-btn sm" data-act="up-' + group + '" data-idx="' + idx + '"' + (idx === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="leo-btn sm" data-act="down-' + group + '" data-idx="' + idx + '"' + (idx === total - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="leo-btn sm danger" data-act="del-' + group + '" data-idx="' + idx + '">删除</button>' +
      '</div>';
  }
  function move(arr, idx, delta) {
    var j = idx + delta;
    if (idx < 0 || j < 0 || j >= arr.length) return false;
    var t = arr[idx]; arr[idx] = arr[j]; arr[j] = t;
    return true;
  }
  /* ======================== 编辑器 模板 ======================== */
  function tplHead() {
    return '<div class="leo-editor-bar">' +
      '<span class="title">主页内容编辑</span>' +
      '<button class="leo-btn sm" data-act="export">导出 site.json</button>' +
      '<button class="leo-btn sm" data-act="import">导入 JSON</button>' +
      '<button class="leo-btn sm" data-act="reset">还原默认</button>' +
      '<button class="leo-btn sm primary" data-act="save">保存</button>' +
      '</div><div class="leo-msg" data-msg></div>';
  }

  function tplBase(c) {
    var navHtml = c.nav.map(function (n, i) {
      return '<div class="leo-edit-item"><div class="head">' +
        '<span class="name">导航 ' + (i + 1) + '</span>' + opsBtns('nav', i, c.nav.length) + '</div>' +
        '<div class="leo-row">' + fText('名称', 'nav.' + i + '.label', n.label) + fText('链接', 'nav.' + i + '.href', n.href) + '</div>' +
        '</div>';
    }).join('');

    var blocksHtml = c.blocks.map(function (b, i) {
      return '<div class="leo-edit-item"><div class="head">' +
        '<span class="name">板块 ' + (i + 1) + '：' + esc(b.title || '(未命名)') + '</span>' + opsBtns('block', i, c.blocks.length) + '</div>' +
        '<div class="leo-row">' +
          fText('图标 (emoji)', 'blocks.' + i + '.icon', b.icon) +
          fText('标题', 'blocks.' + i + '.title', b.title) +
        '</div>' +
        fArea('描述', 'blocks.' + i + '.desc', b.desc, 2) +
        '<div class="leo-row">' +
          fSelect('类型', 'blocks.' + i + '.kind', b.kind, KIND_OPTIONS) +
          fText('链接', 'blocks.' + i + '.href', b.href) +
        '</div>' +
        fCheck('在主页显示该板块', 'blocks.' + i + '.enabled', b.enabled) +
        '</div>';
    }).join('');

    var secHtml = c.sections.map(function (s, i) {
      return '<div class="leo-edit-item"><div class="head">' +
        '<span class="name">拓展板块 ' + (i + 1) + '</span>' + opsBtns('sec', i, c.sections.length) + '</div>' +
        fText('标题', 'sections.' + i + '.title', s.title) +
        fArea('内容', 'sections.' + i + '.text', s.text, 3) +
        fCheck('显示该板块', 'sections.' + i + '.enabled', s.enabled) +
        '</div>';
    }).join('');

    var linkHtml = (c.footer.links || []).map(function (l, i) {
      return '<div class="leo-edit-item"><div class="head">' +
        '<span class="name">页脚链接 ' + (i + 1) + '</span>' +
        '<div class="ops"><button class="leo-btn sm danger" data-act="del-link" data-idx="' + i + '">删除</button></div></div>' +
        '<div class="leo-row">' + fText('名称', 'footer.links.' + i + '.label', l.label) + fText('链接', 'footer.links.' + i + '.href', l.href) + '</div>' +
        '</div>';
    }).join('');

    return '<div class="leo-section"><h2>品牌与导航</h2>' +
      '<div class="leo-edit-item">' +
        '<div class="leo-row">' + fText('站点名称', 'brand.name', c.brand.name) + fText('Logo 文字', 'brand.logo', c.brand.logo) + '</div>' +
      '</div>' + navHtml + '<button class="leo-btn sm" data-act="add-nav">+ 新增导航项</button></div>' +

      '<div class="leo-section"><h2>首屏（Hero）</h2><div class="leo-edit-item">' +
        fText('小标签', 'hero.tagline', c.hero.tagline) +
        fText('大标题', 'hero.title', c.hero.title) +
        fArea('副标题说明', 'hero.subtitle', c.hero.subtitle, 3) +
        '<div class="leo-row">' + fText('主按钮文字', 'hero.primaryText', c.hero.primaryText) + fText('主按钮链接', 'hero.primaryHref', c.hero.primaryHref) + '</div>' +
        '<div class="leo-row">' + fText('次按钮文字', 'hero.secondaryText', c.hero.secondaryText) + fText('次按钮链接', 'hero.secondaryHref', c.hero.secondaryHref) + '</div>' +
      '</div></div>' +

      '<div class="leo-section"><h2>公告</h2><div class="leo-edit-item">' +
        fCheck('显示公告', 'announcement.enabled', c.announcement.enabled) +
        fText('标题', 'announcement.title', c.announcement.title) +
        fArea('内容', 'announcement.text', c.announcement.text, 3) +
      '</div></div>' +

      '<div class="leo-section"><h2>功能板块</h2>' + blocksHtml +
        '<button class="leo-btn sm" data-act="add-block">+ 新增板块</button></div>' +

      '<div class="leo-section"><h2>拓展板块</h2>' + (secHtml || '<p class="leo-empty">暂无拓展板块</p>') +
        '<button class="leo-btn sm" data-act="add-sec">+ 新增拓展板块</button></div>' +

      '<div class="leo-section"><h2>页脚</h2>' +
        '<div class="leo-edit-item">' + fText('页脚文字', 'footer.text', c.footer.text) + '</div>' +
        linkHtml + '<button class="leo-btn sm" data-act="add-link">+ 新增页脚链接</button></div>' +

      '<div class="leo-section"><h2>导入</h2>' +
      '<div class="leo-edit-item leo-hidden" data-import-box>' +
        '<div class="leo-field"><label>粘贴 site.json 内容</label>' +
        '<textarea class="leo-textarea" rows="7" data-import-text placeholder="{ ... }"></textarea></div>' +
        '<div class="ops"><button class="leo-btn sm primary" data-act="import-do">确认导入</button>' +
        '<button class="leo-btn sm" data-act="import-cancel">取消</button></div>' +
      '</div></div>';
  }
  /* ======================== 编辑器 挂载 ======================== */
  function mountEditor(container, opts) {
    opts = opts || {};
    var host = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!host) return null;
    var editing = normalize(clone(get()));

    function msg(text, type, keep) {
      var el = host.querySelector('[data-msg]');
      if (!el) return;
      el.className = 'leo-msg ' + (type || 'info') + (text ? ' show' : '');
      el.textContent = text || '';
      clearTimeout(msg._t);
      if (keep !== true) msg._t = setTimeout(function () { el.classList.remove('show'); }, 5000);
    }
    function afterChange() { if (opts.onSave) opts.onSave(get()); }
    function render() {
      host.innerHTML = tplHead() + tplBase(editing);
      host.classList.add('leo-site-editor');
    }
    function sync() { editing = normalize(clone(get())); render(); }
    function tap() { collect(host, editing); }

    function toggleImport(show) {
      var box = host.querySelector('[data-import-box]');
      if (box) box.classList[show ? 'remove' : 'add']('leo-hidden');
    }

    render();

    host.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn || !host.contains(btn)) return;
      var act = btn.getAttribute('data-act');
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      ev.preventDefault();

      if (act === 'save') {
        tap();
        var r = save(editing);
        if (!r.ok) { msg('保存失败：当前浏览器本地存储不可用', 'err'); return; }
        sync();
        msg('已保存到浏览器本地。如需让所有访问者看到，请点「导出 site.json」并按提示替换仓库文件。', 'ok', true);
        afterChange();
        return;
      }
      if (act === 'reset') {
        if (!global.confirm('确定还原为主页默认内容吗？本地保存的修改将被清除。')) return;
        reset(); sync(); msg('已还原为内置默认内容', 'ok'); afterChange();
        return;
      }
      if (act === 'export') { download('site.json', exportJSON()); msg('已导出 site.json', 'ok'); return; }
      if (act === 'import') { toggleImport(true); return; }
      if (act === 'import-cancel') { toggleImport(false); return; }
      if (act === 'import-do') {
        var ta = host.querySelector('[data-import-text]');
        var r2 = importJSON(ta ? ta.value : '');
        if (!r2.ok) { msg(r2.error, 'err'); return; }
        sync(); msg('导入成功并已保存到本地', 'ok'); afterChange();
        return;
      }

      tap();
      if (act === 'add-nav') { editing.nav.push({ label: '新导航', href: './' }); render(); return; }
      if (act === 'add-block') {
        editing.blocks.push({ id: uid('blk'), icon: '新', title: '新板块', desc: '', href: '', kind: 'link', enabled: true });
        render(); return;
      }
      if (act === 'add-sec') { editing.sections.push({ id: uid('sec'), title: '新拓展板块', text: '', enabled: true }); render(); return; }
      if (act === 'add-link') { editing.footer.links.push({ label: '新链接', href: '' }); render(); return; }

      var m = /^(up|down|del)-(nav|block|sec|link)$/.exec(act);
      if (m) {
        var arr = m[2] === 'link' ? editing.footer.links : (m[2] === 'nav' ? editing.nav : (m[2] === 'block' ? editing.blocks : editing.sections));
        if (!Array.isArray(arr) || isNaN(idx) || idx < 0 || idx >= arr.length) return;
        if (m[1] === 'del') {
          if (!global.confirm('确定删除这一项吗？（保存后生效）')) return;
          arr.splice(idx, 1);
        } else {
          move(arr, idx, m[1] === 'up' ? -1 : 1);
        }
        render();
        return;
      }
    });

    return {
      refresh: sync,
      getConfig: function () { return editing; },
      destroy: function () { host.innerHTML = ''; }
    };
  }

  /* ======================== 对外 API ======================== */
  var API = {
    KEY: KEY,
    FILE: FILE,
    DEFAULT: DEFAULT_SITE,
    get: get,
    load: load,
    save: save,
    reset: reset,
    normalize: normalize,
    exportJSON: exportJSON,
    importJSON: importJSON,
    sourceLabel: sourceLabel,
    mountEditor: mountEditor,
    download: download,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };
  global.LEOSite = API;
})(window);
