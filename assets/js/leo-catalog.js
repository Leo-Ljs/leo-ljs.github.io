/*!
 * Leo 站点 · 游戏目录（自动收录 + 可视化编辑）
 * ---------------------------------------------------------------------------
 * 收录规则：/game/ 下的每个子文件夹视为一个游戏，入口为 <文件夹>/index.html。
 *   - 若服务器开放目录索引（本地开发服务器常见），可自动枚举全部子文件夹；
 *   - GitHub Pages 等静态托管不提供目录索引，则退化为：读取 game/games.json
 *     清单 + 校验/抓取每个条目的标题、描述、封面。
 * 数据优先级：本地保存(localStorage，编辑器对所有人公开) > game/games.json > 内置默认
 * 提供：LEOCatalog.load()/get()/save()/scan()/probeFolder()/mountEditor() ...
 */
(function (global) {
  'use strict';

  var KEY = 'leoljs.catalog.v1';
  var GAMES_FILE = 'game/games.json';
  var DIR = 'game/';
  /* 站点根路径：本脚本位于 <根>/assets/js/ 下 */
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || (function () {
    var list = document.getElementsByTagName('script');
    for (var i = list.length - 1; i >= 0; i--) {
      if (/assets\/js\/leo-catalog\.js(\?|#|$)/.test(list[i].src || '')) return list[i].src;
    }
    return location.href;
  })();
  var ROOT;
  try { ROOT = new URL('../../', SCRIPT_URL).href; } catch (e) { ROOT = './'; }

  var COVER_NAMES = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.gif',
    'thumbnail.png', 'thumb.png', 'preview.png', 'screenshot.png', 'icon.png'];
  var IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

  /* ======================== 内置默认目录（与 game/games.json 保持一致） ======================== */
  var DEFAULT_CATALOG = {
    version: 1,
    type: 'leoljs-games',
    updatedAt: '',
    games: [
      {
        id: 'its_just_minesweeper', name: '扫雷 Minesweeper', folder: 'its_just_minesweeper',
        path: 'its_just_minesweeper/', desc: '经典扫雷玩法，支持鼠标与触屏操作，翻开所有安全格即可通关。',
        tags: ['益智', '经典'], cover: '', order: 1, featured: true, hidden: false
      },
      {
        id: 'o', name: 'ONE OF THESE IS YOU', folder: 'o',
        path: 'o/', desc: '互动解谜风格的网页小游戏，跟随提示找出与众不同的那一个。',
        tags: ['互动', '解谜'], cover: '', order: 2, featured: false, hidden: false
      },
      {
        id: 'progress99', name: '99%', folder: 'progress99',
        path: 'progress99/', desc: '以进度为主题的网页小游戏，在有限条件下推进到终点。',
        tags: ['解谜', '短篇'], cover: '', order: 3, featured: false, hidden: false
      }
    ]
  };

  /* ======================== 工具 ======================== */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slug(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function uid(prefix) { return (prefix || 'g') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toArray(v) {
    if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
    return String(v == null ? '' : v).split(/[,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function readStore() {
    try { var raw = global.localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeStore(cat) {
    try { global.localStorage.setItem(KEY, JSON.stringify(cat)); return true; }
    catch (e) { return false; }
  }
  function normalize(cat) {
    var out = clone(DEFAULT_CATALOG);
    if (cat && typeof cat === 'object' && Array.isArray(cat.games)) {
      out.updatedAt = cat.updatedAt || '';
      out.games = cat.games.map(function (g, i) { return normalizeGame(g, i); }).filter(Boolean);
    }
    return out;
  }
  function normalizeGame(g, i) {
    if (!g || typeof g !== 'object') return null;
    var folder = String(g.folder || '').trim().replace(/^\/+|\/+$/g, '');
    var path = String(g.path || '').trim() || (folder ? folder + '/' : '');
    var name = String(g.name || '').trim() || folder || '未命名游戏';
    var id = String(g.id || '').trim() || slug(folder) || uid();
    return {
      id: id,
      name: name,
      folder: folder,
      path: path,
      desc: String(g.desc || '').trim(),
      tags: toArray(g.tags),
      cover: String(g.cover || '').trim(),
      order: Number(g.order) || (i + 1),
      featured: !!g.featured,
      hidden: !!g.hidden
    };
  }
  /* ======================== 载入 / 保存 ======================== */
  var cache = null;
  var source = 'default';
  var listeners = [];
  var lastScan = null;

  function get() { return cache || (cache = normalize(readStore())); }
  function load() {
    var stored = readStore();
    if (stored) { cache = normalize(stored); source = 'local'; return Promise.resolve(get()); }
    if (!/^https?:$/.test(location.protocol) || typeof global.fetch !== 'function') {
      cache = normalize(null); source = 'default'; return Promise.resolve(get());
    }
    return global.fetch(new URL(GAMES_FILE, ROOT).href, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (data && typeof data === 'object' && Array.isArray(data.games)) { cache = normalize(data); source = 'file'; }
        else { cache = normalize(null); source = 'default'; }
        return get();
      });
  }
  function emit() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    try { document.dispatchEvent(new CustomEvent('leocatalog:change', { detail: { catalog: get(), source: source } })); }
    catch (e) { /* ignore */ }
  }
  function save(cat) {
    cache = normalize(cat);
    cache.updatedAt = new Date().toISOString().slice(0, 10);
    var ok = writeStore(cache);
    if (ok) source = 'local';
    emit();
    return { ok: ok, catalog: get() };
  }
  function reset() {
    try { global.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    cache = normalize(null); source = 'default'; emit(); return get();
  }
  function exportJSON() { return JSON.stringify(normalize(cache || get()), null, 2); }
  function importJSON(text) {
    var data;
    try { data = JSON.parse(String(text || '')); }
    catch (e) { return { ok: false, error: 'JSON 解析失败：' + e.message }; }
    var arr = Array.isArray(data) ? data : (data && data.games);
    if (!Array.isArray(arr)) return { ok: false, error: 'JSON 中未找到 games 数组' };
    return { ok: true, catalog: save({ version: 1, type: 'leoljs-games', games: arr }).catalog };
  }
  function sourceLabel() { return { local: '管理员本地保存', file: GAMES_FILE, default: '内置默认' }[source] || source; }

  /* ======================== 查询 ======================== */
  function gameUrl(g) {
    var p = String((g && g.path) || '').trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.charAt(0) === '/') return p;
    return ROOT + DIR + p.replace(/^\.?\//, '');
  }
  function all() { return get().games.slice(); }
  function list(opts) {
    opts = opts || {};
    var arr = all();
    if (!opts.includeHidden) arr = arr.filter(function (g) { return !g.hidden; });
    if (opts.tag) arr = arr.filter(function (g) { return g.tags.indexOf(opts.tag) >= 0; });
    if (opts.q) {
      var q = String(opts.q).toLowerCase();
      arr = arr.filter(function (g) {
        return (g.name + ' ' + g.desc + ' ' + g.tags.join(' ') + ' ' + g.folder).toLowerCase().indexOf(q) >= 0;
      });
    }
    var sort = opts.sort || 'order';
    arr.sort(function (a, b) {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
      if (sort === 'new') return b.order - a.order;
      return a.order - b.order;
    });
    if (opts.featuredFirst) {
      arr.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });
    }
    return arr;
  }
  function tags() {
    var seen = {};
    all().forEach(function (g) { if (!g.hidden) g.tags.forEach(function (t) { seen[t] = (seen[t] || 0) + 1; }); });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; })
      .map(function (t) { return { tag: t, count: seen[t] }; });
  }
  function stats() {
    var arr = all();
    var hidden = arr.filter(function (g) { return g.hidden; }).length;
    return { total: arr.length, visible: arr.length - hidden, hidden: hidden, featured: arr.filter(function (g) { return g.featured; }).length };
  }
  function upsert(game) {
    var cat = normalize(clone(get()));
    var rec = normalizeGame(game, cat.games.length);
    if (!rec) return { ok: false, error: '游戏数据无效' };
    var idx = -1;
    cat.games.forEach(function (g, i) { if (g.id === rec.id || (rec.folder && g.folder === rec.folder)) idx = i; });
    if (idx >= 0) cat.games[idx] = rec; else cat.games.push(rec);
    return { ok: true, catalog: save(cat).catalog, index: idx };
  }
  function remove(idOrFolder) {
    var cat = normalize(clone(get()));
    var before = cat.games.length;
    cat.games = cat.games.filter(function (g) { return g.id !== idOrFolder && g.folder !== idOrFolder; });
    if (cat.games.length === before) return { ok: false, error: '未找到该游戏' };
    return { ok: true, catalog: save(cat).catalog };
  }
  /* ======================== 目录扫描 / 信息抓取 ======================== */
  function dirUrl() { return new URL(DIR, ROOT).href; }
  function folderUrl(folder) { return dirUrl() + encodeURIComponent(folder) + '/'; }
  function canFetch() { return /^https?:$/.test(location.protocol) && typeof global.fetch === 'function'; }

  /* 解析目录索引页，取出直接子文件夹名 */
  function parseListing(html) {
    var names = [], seen = {};
    function push(n) {
      n = String(n || '').replace(/\/+$/, '').trim();
      if (!n || n === '.' || n === '..' || n.charAt(0) === '.' || n.charAt(0) === '_') return;
      if (seen[n]) return;
      seen[n] = 1; names.push(n);
    }
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var as = doc.querySelectorAll('a[href]');
      for (var i = 0; i < as.length; i++) {
        var href = (as[i].getAttribute('href') || '').split(/[?#]/)[0];
        if (!/\/$/.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.charAt(0) === '/') continue;
        if (href.indexOf('/') !== href.replace(/\/$/, '').lastIndexOf('/') + 1) continue;
        push(decodeURIComponent(href));
      }
    } catch (e) { /* ignore */ }
    if (!names.length) {
      var m, re = /href\s*=\s*["']([^"'\/\\:]+)\/["']/gi;
      while ((m = re.exec(html))) push(decodeURIComponent(m[1]));
    }
    return names;
  }

  function discoverFolders() {
    if (!canFetch()) return Promise.resolve([]);
    return global.fetch(dirUrl(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) { return text ? parseListing(text) : []; })
      .catch(function () { return []; });
  }

  function parseMeta(html, folder) {
    var info = { title: '', desc: '', cover: '' };
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var t = doc.querySelector('title');
      if (t) info.title = String(t.textContent || '').trim();
      var md = doc.querySelector('meta[name="description"]') || doc.querySelector('meta[property="og:description"]');
      if (md) info.desc = String(md.getAttribute('content') || '').trim();
      var og = doc.querySelector('meta[property="og:image"]') || doc.querySelector('meta[name="cover"]');
      if (og) info.cover = String(og.getAttribute('content') || '').trim();
    } catch (e) { /* ignore */ }
    if (!info.title) info.title = /<title>([^<]*)<\/title>/i.exec(html) ? RegExp.$1.trim() : '';
    return info;
  }

  function probeImage(urls, i) {
    i = i || 0;
    if (i >= urls.length) return Promise.resolve('');
    return new Promise(function (resolve) {
      var img = new global.Image();
      img.onload = function () { resolve(urls[i]); };
      img.onerror = function () { resolve(probeImage(urls, i + 1)); };
      img.src = urls[i];
    });
  }

  /* 抓取单个文件夹入口页的标题 / 描述 / 封面 */
  function probeFolder(folder, opts) {
    opts = opts || {};
    folder = String(folder || '').trim().replace(/^\/+|\/+$/g, '');
    var base = folderUrl(folder);
    if (!canFetch()) {
      return Promise.resolve({ ok: false, folder: folder, url: base, error: '当前环境无法联网抓取（file:// 或无 fetch）' });
    }
    return global.fetch(base + 'index.html', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return null;
        return r.text();
      })
      .catch(function () { return null; })
      .then(function (html) {
        if (html == null) return { ok: false, folder: folder, url: base, error: '未找到 ' + folder + '/index.html' };
        var meta = parseMeta(html, folder);
        var cover = meta.cover;
        var tasks = [];
        if (cover && !/^[a-z][a-z0-9+.-]*:/i.test(cover) && cover.charAt(0) !== '/') {
          cover = base + cover.replace(/^\.?\//, '');
        }
        if (!cover) {
          tasks.push(probeImage(COVER_NAMES.map(function (n) { return base + n; })));
        } else {
          tasks.push(Promise.resolve(cover));
        }
        return Promise.all(tasks).then(function (res) {
          return { ok: true, folder: folder, url: base, title: meta.title || folder, desc: meta.desc, cover: res[0] || '' };
        });
      });
  }
  /* 扫描并收录：opts.refresh 覆盖已有条目信息，opts.save=false 不写入本地 */
  function scan(opts) {
    opts = opts || {};
    var res = { method: 'none', listed: [], added: [], updated: [], missing: [], checked: 0, error: '', changed: false, at: 0 };
    return discoverFolders().then(function (names) {
      var cat = normalize(clone(get()));
      var byFolder = {};
      cat.games.forEach(function (g) { if (g.folder) byFolder[g.folder] = g; });
      var targets = [];
      if (names.length) {
        res.method = 'listing';
        res.listed = names.slice();
        names.forEach(function (n) { targets.push(n); });
      } else {
        res.method = 'probe';
        res.error = '当前服务器未开放目录索引，无法自动枚举 game/ 下的子文件夹；已改为逐个校验目录清单中已有的条目。';
        cat.games.forEach(function (g) { if (g.folder) targets.push(g.folder); });
      }
      var maxOrder = cat.games.reduce(function (m, g) { return Math.max(m, g.order || 0); }, 0);
      var chain = Promise.resolve();
      targets.forEach(function (folder) {
        chain = chain.then(function () {
          return probeFolder(folder, opts).then(function (info) {
            res.checked++;
            if (!info.ok) { res.missing.push(folder); return; }
            var rec = byFolder[folder];
            if (!rec) {
              rec = normalizeGame({
                folder: folder, path: folder + '/', name: info.title, desc: info.desc,
                cover: info.cover, order: ++maxOrder
              }, cat.games.length);
              cat.games.push(rec);
              byFolder[folder] = rec;
              if (res.added.indexOf(rec.name) < 0) res.added.push(rec.name);
              return;
            }
            var touched = false;
            if (opts.refresh) {
              if (info.title && info.title !== rec.name) { rec.name = info.title; touched = true; }
              if (info.desc && info.desc !== rec.desc) { rec.desc = info.desc; touched = true; }
              if (info.cover && info.cover !== rec.cover) { rec.cover = info.cover; touched = true; }
            } else {
              if (!rec.name && info.title) { rec.name = info.title; touched = true; }
              if (!rec.desc && info.desc) { rec.desc = info.desc; touched = true; }
              if (!rec.cover && info.cover) { rec.cover = info.cover; touched = true; }
            }
            if (!rec.path) { rec.path = folder + '/'; touched = true; }
            if (touched) res.updated.push(rec.name);
          }).catch(function () { res.missing.push(folder); });
        });
      });
      return chain.then(function () {
        res.changed = res.added.length > 0 || res.updated.length > 0;
        res.at = Date.now();
        if (res.changed && opts.save !== false) save(cat);
        lastScan = clone(res);
        return res;
      });
    });
  }
  function getLastScan() { return lastScan; }
  function scanSummary(res) {
    if (!res) return '尚未扫描';
    var parts = [];
    parts.push(res.method === 'listing' ? ('目录索引发现 ' + res.listed.length + ' 个文件夹') : '无目录索引（逐条校验）');
    parts.push('校验 ' + res.checked + ' 个');
    if (res.added.length) parts.push('新增 ' + res.added.length + '：' + res.added.join('、'));
    if (res.updated.length) parts.push('更新 ' + res.updated.length + '：' + res.updated.join('、'));
    if (res.missing.length) parts.push('缺失入口 ' + res.missing.length + '：' + res.missing.join('、'));
    return parts.join('；');
  }
  function selftest() {
    return { ok: true, games: all().length, source: sourceLabel(), dir: dirUrl() };
  }
  /* ======================== 编辑器 字段工具 ======================== */
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
  function collect(host, cat) {
    var list = host.querySelectorAll('[data-path]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      setPath(cat, el.getAttribute('data-path'), el.type === 'checkbox' ? !!el.checked : el.value);
    }
    return cat;
  }
  function sortedGames(arr) {
    return arr.slice().sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  }
  function finalize(c) {
    c.games = c.games.map(function (g, i) {
      var rec = clone(g);
      if (rec.tagsText != null) { rec.tags = toArray(rec.tagsText); delete rec.tagsText; }
      rec.order = Number(rec.order) || (i + 1);
      rec.folder = String(rec.folder || '').trim().replace(/^\/+|\/+$/g, '');
      rec.id = String(rec.id || '').trim() || slug(rec.folder) || uid();
      rec.path = String(rec.path || '').trim() || (rec.folder ? rec.folder + '/' : '');
      rec.name = String(rec.name || '').trim() || rec.folder || '未命名游戏';
      return rec;
    });
    return c;
  }

  /* ======================== 编辑器 模板 ======================== */
  function tplItem(g, i, total) {
    return '<div class="leo-edit-item"><div class="head">' +
      '<span class="name">#' + (i + 1) + ' ' + esc(g.name || '未命名') +
        (g.hidden ? ' <span class="leo-badge p0">隐藏</span>' : '') +
        (g.featured ? ' <span class="leo-badge p2">推荐</span>' : '') + '</span>' +
      '<div class="ops">' +
        '<button class="leo-btn sm" data-act="open" data-idx="' + i + '">预览</button>' +
        '<button class="leo-btn sm" data-act="grab" data-idx="' + i + '">抓取信息</button>' +
        '<button class="leo-btn sm" data-act="up" data-idx="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="leo-btn sm" data-act="down" data-idx="' + i + '"' + (i === total - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="leo-btn sm danger" data-act="del" data-idx="' + i + '">删除</button>' +
      '</div></div>' +
      '<div class="leo-row">' +
        fText('显示名称', 'games.' + i + '.name', g.name) +
        fText('文件夹', 'games.' + i + '.folder', g.folder, '例如 my_game') +
      '</div>' +
      '<div class="leo-row">' +
        fText('入口路径', 'games.' + i + '.path', g.path, 'folder/ 或完整 URL') +
        fText('排序号', 'games.' + i + '.order', g.order, '数字越小越靠前') +
      '</div>' +
      fArea('简介', 'games.' + i + '.desc', g.desc, 2) +
      '<div class="leo-row">' +
        fText('标签（逗号分隔）', 'games.' + i + '.tagsText', (g.tags || []).join(', '), '益智, 经典') +
        fText('封面图 URL', 'games.' + i + '.cover', g.cover, '可选，留空自动生成封面') +
      '</div>' +
      '<div class="leo-row">' +
        fCheck('在列表隐藏', 'games.' + i + '.hidden', g.hidden) +
        fCheck('首页推荐', 'games.' + i + '.featured', g.featured) +
        fText('ID（唯一标识）', 'games.' + i + '.id', g.id) +
      '</div></div>';
  }

  function tplCat(c) {
    var items = c.games.map(function (g, i) { return tplItem(g, i, c.games.length); }).join('');
    return '<div class="leo-editor-bar">' +
      '<span class="title">游戏目录编辑</span>' +
      '<button class="leo-btn sm" data-act="scan">扫描 game/ 目录</button>' +
      '<button class="leo-btn sm" data-act="scan-refresh">扫描并覆盖信息</button>' +
      '<button class="leo-btn sm" data-act="add">新增条目</button>' +
      '<button class="leo-btn sm" data-act="export">导出 games.json</button>' +
      '<button class="leo-btn sm" data-act="import">导入 JSON</button>' +
      '<button class="leo-btn sm" data-act="reset">还原默认</button>' +
      '<button class="leo-btn sm primary" data-act="save">保存</button>' +
      '</div>' +
      '<div class="leo-field"><label>批量收录文件夹（每行一个文件夹名，位于 ' + esc(DIR) + ' 下）</label>' +
      '<textarea class="leo-textarea" rows="2" data-bulk placeholder="my_game&#10;another_game"></textarea></div>' +
      '<div class="ops" style="margin-bottom:12px">' +
      '<button class="leo-btn sm" data-act="bulk-grab">抓取信息并加入</button>' +
      '<button class="leo-btn sm" data-act="bulk-add">仅按名称加入</button>' +
      '</div>' +
      '<div class="leo-msg" data-msg></div>' +
      '<div class="leo-msg" data-status></div>' +
      '<div class="leo-section"><h2>目录条目（' + c.games.length + '）</h2>' +
      (items || '<p class="leo-empty">暂无条目，可点击「扫描 game/ 目录」自动收录</p>') +
      '</div>' +
      '<div class="leo-section"><h2>导入 JSON</h2><div class="leo-edit-item leo-hidden" data-import-box>' +
      '<div class="leo-field"><label>粘贴 games.json 内容（对象或数组）</label>' +
      '<textarea class="leo-textarea" rows="7" data-import-text placeholder="{ "games": [ ... ] }"></textarea></div>' +
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
    var busy = false;

    function msg(text, type, keep) {
      var el = host.querySelector('[data-msg]');
      if (!el) return;
      el.className = 'leo-msg ' + (type || 'info') + (text ? ' show' : '');
      el.textContent = text || '';
      clearTimeout(msg._t);
      if (keep !== true) msg._t = setTimeout(function () { el.classList.remove('show'); }, 6000);
    }
    function status(text) {
      var el = host.querySelector('[data-status]');
      if (!el) return;
      el.className = 'leo-msg info' + (text ? ' show' : '');
      el.textContent = text || '';
    }
    function render() {
      editing.games = sortedGames(editing.games);
      host.innerHTML = tplCat(editing);
      host.classList.add('leo-site-editor');
      status('数据来源：' + sourceLabel() + '；扫描结果：' + scanSummary(lastScan));
    }
    function sync() { editing = normalize(clone(get())); render(); if (opts.onChange) opts.onChange(get()); }
    function tap() { collect(host, editing); finalize(editing); }
    function toggleImport(show) {
      var box = host.querySelector('[data-import-box]');
      if (box) box.classList[show ? 'remove' : 'add']('leo-hidden');
    }
    function bulkNames() {
      var ta = host.querySelector('[data-bulk]');
      return String(ta ? ta.value : '').split(/[\r\n,，;；]+/)
        .map(function (s) { return s.trim().replace(/^\/+|\/+$/g, ''); })
        .filter(function (s) { return !!s; });
    }
    function addByName(folder, info) {
      var dup = editing.games.some(function (g) { return g.folder === folder; });
      if (dup) return false;
      var next = editing.games.reduce(function (m, g) { return Math.max(m, Number(g.order) || 0); }, 0) + 1;
      editing.games.push(normalizeGame({
        folder: folder, path: folder + '/',
        name: (info && info.title) || folder,
        desc: (info && info.desc) || '',
        cover: (info && info.cover) || '',
        tags: (info && info.tags) || [],
        order: next
      }, editing.games.length));
      return true;
    }
    function runScan(refresh) {
      if (busy) return;
      busy = true;
      msg('正在扫描 ' + DIR + ' ……', 'info', true);
      tap();
      save(editing);
      return scan({ covers: true, refresh: !!refresh }).then(function (res) {
        busy = false;
        sync();
        msg(scanSummary(res), res.changed ? 'ok' : 'info', true);
        if (res.error) status(res.error);
      }).catch(function (e) {
        busy = false;
        msg('扫描失败：' + (e && e.message ? e.message : e), 'err');
      });
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
        msg('已保存到浏览器本地。如需所有访问者看到，请「导出 games.json」并按提示替换仓库文件。', 'ok', true);
        return;
      }
      if (act === 'reset') {
        if (!global.confirm('确定还原为内置默认游戏目录吗？本地保存的修改将被清除。')) return;
        reset(); sync(); msg('已还原为内置默认目录', 'ok');
        return;
      }
      if (act === 'export') { downloadJSON('games.json', exportJSON()); msg('已导出 games.json', 'ok'); return; }
      if (act === 'import') { toggleImport(true); return; }
      if (act === 'import-cancel') { toggleImport(false); return; }
      if (act === 'import-do') {
        var ta = host.querySelector('[data-import-text]');
        var r2 = importJSON(ta ? ta.value : '');
        if (!r2.ok) { msg(r2.error, 'err'); return; }
        sync(); msg('导入成功并已保存到本地', 'ok');
        return;
      }
      if (act === 'scan') { runScan(false); return; }
      if (act === 'scan-refresh') { runScan(true); return; }

      tap();
      if (act === 'add') {
        var next = editing.games.reduce(function (m, g) { return Math.max(m, Number(g.order) || 0); }, 0) + 1;
        editing.games.push(normalizeGame({ folder: '', path: '', name: '新游戏', desc: '', tags: [], order: next }, editing.games.length));
        render();
        return;
      }
      if (act === 'bulk-add' || act === 'bulk-grab') {
        var names = bulkNames();
        if (!names.length) { msg('请先填写要收录的文件夹名（每行一个）', 'err'); return; }
        if (act === 'bulk-add') {
          var added = names.filter(function (n) { return addByName(n); }).length;
          render();
          msg('已加入 ' + added + ' 个条目' + (added < names.length ? '（其余已存在）' : '') + '，请检查后保存', 'ok');
          return;
        }
        if (busy) return;
        busy = true;
        msg('正在抓取 ' + names.length + ' 个文件夹的信息……', 'info', true);
        var chain = Promise.resolve(), okCount = 0;
        names.forEach(function (n) {
          chain = chain.then(function () {
            return probeFolder(n, { covers: true }).then(function (info) {
              if (info && info.ok && addByName(n, info)) okCount++;
            }).catch(function () { /* ignore */ });
          });
        });
        chain.then(function () {
          busy = false;
          render();
          msg('抓取完成，新增 ' + okCount + ' 个条目，请检查后保存', okCount ? 'ok' : 'err');
        });
        return;
      }
      if (act === 'open') {
        var g = editing.games[idx];
        if (g) global.open(gameUrl(g), '_blank', 'noopener');
        return;
      }
      if (act === 'grab') {
        var g2 = editing.games[idx];
        if (!g2 || !g2.folder) { msg('请先填写文件夹名', 'err'); return; }
        msg('正在抓取 ' + g2.folder + ' ……', 'info', true);
        probeFolder(g2.folder, { covers: true }).then(function (info) {
          if (!info.ok) { msg(info.error || '抓取失败', 'err'); return; }
          if (info.title) g2.name = info.title;
          if (info.desc) g2.desc = info.desc;
          if (info.cover) g2.cover = info.cover;
          render();
          msg('已抓取「' + g2.name + '」的标题、简介与封面，请保存', 'ok');
        });
        return;
      }
      if (act === 'del') {
        var g3 = editing.games[idx];
        if (!g3) return;
        if (!global.confirm('确定从目录中删除「' + g3.name + '」吗？游戏文件夹本身不会被删除。')) return;
        editing.games.splice(idx, 1);
        render();
        return;
      }
      if (act === 'up' || act === 'down') {
        var j = idx + (act === 'up' ? -1 : 1);
        if (idx < 0 || j < 0 || j >= editing.games.length) return;
        var nA = Number(editing.games[idx].order) || (idx + 1);
        var nB = Number(editing.games[j].order) || (j + 1);
        if (nA === nB) { editing.games[idx].order = j + 1; editing.games[j].order = idx + 1; }
        else { editing.games[idx].order = nB; editing.games[j].order = nA; }
        render();
        return;
      }
    });

    return {
      refresh: sync,
      getCatalog: function () { return editing; },
      scan: runScan,
      destroy: function () { host.innerHTML = ''; }
    };
  }

  function downloadJSON(filename, text) {
    var blob = new Blob([String(text)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  /* ======================== 对外 API ======================== */
  var API = {
    KEY: KEY,
    DIR: DIR,
    FILE: GAMES_FILE,
    DEFAULT: DEFAULT_CATALOG,
    load: load,
    get: get,
    save: save,
    reset: reset,
    normalize: normalize,
    exportJSON: exportJSON,
    importJSON: importJSON,
    sourceLabel: sourceLabel,
    all: all,
    list: list,
    tags: tags,
    stats: stats,
    upsert: upsert,
    remove: remove,
    gameUrl: gameUrl,
    dirUrl: dirUrl,
    folderUrl: folderUrl,
    parseListing: parseListing,
    parseMeta: parseMeta,
    probeFolder: probeFolder,
    discoverFolders: discoverFolders,
    scan: scan,
    scanSummary: scanSummary,
    getLastScan: getLastScan,
    selftest: selftest,
    downloadJSON: downloadJSON,
    mountEditor: mountEditor,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };
  global.LEOCatalog = API;
})(window);
