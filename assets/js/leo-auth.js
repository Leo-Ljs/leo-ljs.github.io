/*!
 * Leo 站点 · 账户与权限系统（纯前端实现，数据保存在浏览器 localStorage）
 * ---------------------------------------------------------------------------
 * 说明：本站是纯静态站点（GitHub Pages），没有后端，因此账户体系运行在浏览器端，
 *       用于“站点内容管理”的分级授权与可视化编辑，不是服务器级安全边界。
 *       - 不支持注册；账户只能由权限 4 的超级管理员新增 / 修改 / 删除。
 *       - 默认账户：admin / admin（权限 4），首次打开自动创建。
 *       - 任何账户都可以修改自己的“名称（不可重名）”和“密码”。
 *       - 权限 0/1/2/3/4，数字越大能力越多（见 LEOAuth.PERMS / LEOAuth.CAPS）。
 *
 * 依赖：无（原生 JS）。用法：
 *   window.LEOAuth.ready.then(function(){ ... });
 */
(function (global) {
  'use strict';

  /* ======================== 常量 ======================== */
  var KEY_ACCOUNTS = 'leoljs.accounts.v1';
  var KEY_SESSION  = 'leoljs.session.v1';
  var SESSION_DAYS = 7;

  var DEFAULT_ADMIN = { name: 'admin', password: 'admin', perm: 4 };
  var NAME_MIN = 2, NAME_MAX = 20;
  var PASS_MIN = 4, PASS_MAX = 64;

  /* 站点根路径：本脚本位于 <根>/assets/js/ 下 */
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || (function () {
    var list = document.getElementsByTagName('script');
    for (var i = list.length - 1; i >= 0; i--) {
      if (/leo-auth\.js(\?|#|$)/.test(list[i].src || '')) return list[i].src;
    }
    return location.href;
  })();
  var ROOT;
  try { ROOT = new URL('../../', SCRIPT_URL).href; } catch (e) { ROOT = './'; }
  var ACCOUNTS_FILE = 'assets/data/accounts.json';   // 可选：提交到仓库的默认账户表

  /* ======================== 权限定义 ======================== */
  var PERMS = [
    { level: 0, label: '受限访客', short: '访客',   desc: '仅可浏览主页面公开内容',        color: '#c3c1d4' },
    { level: 1, label: '浏览者',   short: '浏览',   desc: '可进入游戏中心与音乐播放器',    color: '#7dd3fc' },
    { level: 2, label: '高级成员', short: '成员',   desc: '额外可用个人中心、收藏与偏好',  color: '#6ee7b7' },
    { level: 3, label: '内容审核员', short: '审核', desc: '可只读查看账户、导出目录快照',  color: '#fcd34d' },
    { level: 4, label: '超级管理员', short: '超管', desc: '可管理主页内容、游戏目录与账户', color: '#ffffff' }
  ];

  var CAPS = [
    { key: 'viewHome',       perm: 0, label: '浏览主页面' },
    { key: 'viewGames',      perm: 1, label: '进入游戏中心' },
    { key: 'useMusic',       perm: 1, label: '使用音乐播放器' },
    { key: 'personal',       perm: 2, label: '个人中心 / 收藏 / 偏好设置' },
    { key: 'exportCatalog',  perm: 3, label: '导出游戏目录快照（games.json）' },
    { key: 'viewAccounts',   perm: 3, label: '查看账户列表（只读）' },
    { key: 'editSite',       perm: 4, label: '编辑主页内容（板块 / 公告 / 导航）' },
    { key: 'editCatalog',    perm: 4, label: '可视化编辑游戏目录' },
    { key: 'manageAccounts', perm: 4, label: '管理账户（新增 / 修改 / 删除 / 权限）' }
  ];

  var CAP_MIN = {};
  CAPS.forEach(function (c) { CAP_MIN[c.key] = c.perm; });

  /* ======================== 小工具 ======================== */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function normName(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' '); }
  function nameKey(s) { return normName(s).toLowerCase(); }
  function permOf(v) { var n = parseInt(v, 10); return (n >= 0 && n <= 4) ? n : NaN; }
  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
  }
  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  /* 兜底哈希（file:// 等无 crypto.subtle 的环境使用），带盐，双重 FNV-1a */
  function weakHash(pw, salt) {
    var t = 'leoljs$' + salt + '$' + pw + '$';
    return fnv(t, 0x811c9dc5) + fnv(t.split('').reverse().join('') + salt, 0x1000193);
  }
  function randomSalt() {
    try {
      var a = new Uint8Array(8);
      if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(a);
      else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      return hex(a);
    } catch (e) { return Math.random().toString(36).slice(2, 12); }
  }
  function canSubtle() {
    return !!(global.crypto && global.crypto.subtle && typeof global.crypto.subtle.digest === 'function');
  }
  function sha256(text) {
    return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return hex(new Uint8Array(buf));
    });
  }
  /* 返回 Promise<{alg, hash}>；hash 为当前首选算法，legacy 恒为兜底算法（跨环境可登录） */
  function makeHash(pw, salt) {
    var legacy = weakHash(pw, salt);
    if (!canSubtle()) return Promise.resolve({ alg: 'fnv1a', hash: legacy, legacy: legacy });
    return sha256('leoljs$' + salt + '$' + pw).then(function (h) {
      return { alg: 'sha256', hash: h, legacy: legacy };
    }).catch(function () {
      return { alg: 'fnv1a', hash: legacy, legacy: legacy };
    });
  }
  function checkHash(rec, pw) {
    var legacy = weakHash(pw, rec.salt || '');
    if (rec.hashAlg === 'sha256') {
      if (!canSubtle()) return Promise.resolve(legacy === rec.legacy);
      return sha256('leoljs$' + (rec.salt || '') + '$' + pw).then(function (h) {
        return h === rec.hash || legacy === rec.legacy;
      }).catch(function () { return legacy === rec.legacy; });
    }
    return Promise.resolve(legacy === rec.hash || legacy === rec.legacy);
  }
  /* ======================== 存储层 ======================== */
  function makeStore(area) {
    var mem = {};
    return {
      get: function (k) {
        try { return area.getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; }
      },
      set: function (k, v) {
        try { area.setItem(k, v); } catch (e) { mem[k] = String(v); }
      },
      del: function (k) {
        try { area.removeItem(k); } catch (e) { delete mem[k]; }
      }
    };
  }
  var store = makeStore(global.localStorage);
  var sstore = makeStore(global.sessionStorage);

  function readJSON(s, k, fallback) {
    var raw = s.get(k);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  /* ======================== 账户记录 ======================== */
  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = normName(raw.name);
    if (!name) return null;
    var perm = permOf(raw.perm);
    if (isNaN(perm)) perm = 0;
    var created = Number(raw.createdAt) || Date.now();
    return {
      id: (typeof raw.id === 'string' && raw.id) ? raw.id : uid(),
      name: name,
      perm: perm,
      salt: (typeof raw.salt === 'string' && raw.salt) ? raw.salt : randomSalt(),
      hash: typeof raw.hash === 'string' ? raw.hash : '',
      hashAlg: raw.hashAlg === 'sha256' ? 'sha256' : 'fnv1a',
      legacy: typeof raw.legacy === 'string' ? raw.legacy : '',
      note: typeof raw.note === 'string' ? normName(raw.note) : '',
      isDefault: !!raw.isDefault,
      createdAt: created,
      updatedAt: Number(raw.updatedAt) || created
    };
  }

  function readAccounts() {
    var arr = readJSON(store, KEY_ACCOUNTS, []);
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (r) { var n = normalizeRecord(r); if (n) out.push(n); });
    return out;
  }
  function writeAccounts(list) {
    store.set(KEY_ACCOUNTS, JSON.stringify(list));
  }
  function pub(rec) {
    if (!rec) return null;
    return {
      id: rec.id, name: rec.name, perm: rec.perm, note: rec.note || '',
      isDefault: !!rec.isDefault, createdAt: rec.createdAt, updatedAt: rec.updatedAt
    };
  }
  function findById(id) {
    if (!id) return null;
    var list = readAccounts();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findByName(name) {
    var k = nameKey(name);
    if (!k) return null;
    var list = readAccounts();
    for (var i = 0; i < list.length; i++) if (nameKey(list[i].name) === k) return list[i];
    return null;
  }
  function countAdmins(list) {
    var n = 0;
    (list || readAccounts()).forEach(function (r) { if (r.perm === 4) n++; });
    return n;
  }
  function makeRecord(name, perm, password, isDefault, note) {
    var salt = randomSalt();
    return makeHash(password, salt).then(function (h) {
      return {
        id: uid(), name: normName(name), perm: perm, salt: salt,
        hash: h.hash, hashAlg: h.alg, legacy: h.legacy,
        note: note || '', isDefault: !!isDefault,
        createdAt: Date.now(), updatedAt: Date.now()
      };
    });
  }

  /* ======================== 会话 ======================== */
  function setSession(rec, remember) {
    var data = {
      id: rec.id, name: rec.name, perm: rec.perm,
      exp: Date.now() + SESSION_DAYS * 86400000, remember: !!remember
    };
    var json = JSON.stringify(data);
    if (remember) { store.set(KEY_SESSION, json); sstore.del(KEY_SESSION); }
    else { sstore.set(KEY_SESSION, json); store.del(KEY_SESSION); }
  }
  function readSession() {
    var d = readJSON(sstore, KEY_SESSION, null) || readJSON(store, KEY_SESSION, null);
    if (!d || !d.id) return null;
    if (d.exp && d.exp < Date.now()) { clearSession(); return null; }
    return d;
  }
  function clearSession() {
    store.del(KEY_SESSION);
    sstore.del(KEY_SESSION);
  }
  function current() {
    var s = readSession();
    if (!s) return null;
    var rec = findById(s.id);
    if (!rec) { clearSession(); return null; }
    return rec;
  }
  function perm() { var c = current(); return c ? c.perm : 0; }

  /* ======================== 事件 ======================== */
  var listeners = [];
  function on(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function emit(evt) {
    listeners.slice().forEach(function (fn) {
      try { fn(evt || 'change'); } catch (e) { /* ignore */ }
    });
  }
  try {
    global.addEventListener('storage', function (e) {
      if (e && (e.key === KEY_ACCOUNTS || e.key === KEY_SESSION)) emit('external');
    });
  } catch (e) { /* ignore */ }
  /* ======================== 校验 ======================== */
  function validateName(name, exceptId) {
    var n = normName(name);
    if (!n) return { ok: false, error: '名称不能为空' };
    if (n.length < NAME_MIN || n.length > NAME_MAX) {
      return { ok: false, error: '名称长度需为 ' + NAME_MIN + '-' + NAME_MAX + ' 个字符' };
    }
    if (/[\\/<>"'`]/.test(n)) return { ok: false, error: '名称不能包含 \\ / < > " \' ` 等字符' };
    var exist = findByName(n);
    if (exist && exist.id !== exceptId) return { ok: false, error: '名称「' + n + '」已被占用，请换一个' };
    return { ok: true, name: n };
  }
  function validatePassword(pw) {
    var p = String(pw == null ? '' : pw);
    if (p.length < PASS_MIN || p.length > PASS_MAX) {
      return { ok: false, error: '密码长度需为 ' + PASS_MIN + '-' + PASS_MAX + ' 位' };
    }
    return { ok: true, password: p };
  }
  function requireAdmin() {
    var c = current();
    if (!c) return { ok: false, error: '请先登录账户' };
    if (c.perm !== 4) return { ok: false, error: '该操作需要超级管理员（权限 4）权限' };
    return { ok: true, actor: c };
  }

  /* ======================== 初始化 / 默认账户 ======================== */
  /* 可选：仓库里提交 assets/data/accounts.json 可让账户表在访问者间共享 */
  function loadAccountsFile() {
    if (!/^https?:$/.test(location.protocol) || typeof global.fetch !== 'function') {
      return Promise.resolve(null);
    }
    return global.fetch(new URL(ACCOUNTS_FILE, ROOT).href, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return null;
        var arr = Array.isArray(data) ? data : (data.accounts || []);
        var out = [];
        arr.forEach(function (r) { var n = normalizeRecord(r); if (n) out.push(n); });
        return (out.length && countAdmins(out) > 0) ? out : null;
      })
      .catch(function () { return null; });
  }

  var ready = Promise.resolve().then(function () {
    if (readAccounts().length) return 'existing';
    return loadAccountsFile().then(function (list) {
      if (list) { writeAccounts(list); return 'file'; }
      return makeRecord(DEFAULT_ADMIN.name, DEFAULT_ADMIN.perm, DEFAULT_ADMIN.password, true, '内置默认管理员')
        .then(function (rec) { writeAccounts([rec]); return 'default'; });
    });
  });

  /* ======================== 账户操作 ======================== */
  function listAccounts() {
    return readAccounts().map(pub).sort(function (a, b) {
      if (b.perm !== a.perm) return b.perm - a.perm;
      return a.createdAt - b.createdAt;
    });
  }

  function createAccount(data, opts) {
    data = data || {};
    if (!(opts && opts.force)) {
      var g = requireAdmin();
      if (!g.ok) return Promise.resolve(g);
    }
    var nv = validateName(data.name, null);
    if (!nv.ok) return Promise.resolve(nv);
    var pv = validatePassword(data.password);
    if (!pv.ok) return Promise.resolve(pv);
    var p = permOf(data.perm);
    if (isNaN(p)) p = 1;
    return makeRecord(nv.name, p, pv.password, false, data.note).then(function (rec) {
      var list = readAccounts();
      list.push(rec);
      writeAccounts(list);
      emit('accounts');
      return { ok: true, account: pub(rec) };
    });
  }

  function updateAccount(id, patch, opts) {
    if (!(opts && opts.force)) {
      var g = requireAdmin();
      if (!g.ok) return g;
    }
    patch = patch || {};
    var list = readAccounts(), idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) idx = i;
    if (idx < 0) return { ok: false, error: '账户不存在' };
    var rec = list[idx];
    if (patch.name != null) {
      var nv = validateName(patch.name, id);
      if (!nv.ok) return nv;
      rec.name = nv.name;
    }
    if (patch.perm != null) {
      var p = permOf(patch.perm);
      if (isNaN(p)) return { ok: false, error: '权限值无效（应为 0-4）' };
      if (rec.perm === 4 && p !== 4 && countAdmins(list) <= 1) {
        return { ok: false, error: '至少需要保留 1 个权限 4 的超级管理员' };
      }
      rec.perm = p;
    }
    if (patch.note != null) rec.note = normName(patch.note);
    rec.updatedAt = Date.now();
    list[idx] = rec;
    writeAccounts(list);
    emit('accounts');
    var s = readSession();
    if (s && s.id === id) setSession(rec, s.remember);
    return { ok: true, account: pub(rec) };
  }

  function removeAccount(id, opts) {
    if (!(opts && opts.force)) {
      var g = requireAdmin();
      if (!g.ok) return g;
    }
    var list = readAccounts(), target = null, next = [];
    list.forEach(function (r) { if (r.id === id) target = r; else next.push(r); });
    if (!target) return { ok: false, error: '账户不存在' };
    var me = current();
    if (me && me.id === id) return { ok: false, error: '不能删除当前登录的账户，请改用其他管理员账户操作' };
    if (target.perm === 4 && countAdmins(next) < 1) {
      return { ok: false, error: '至少需要保留 1 个权限 4 的超级管理员' };
    }
    writeAccounts(next);
    emit('accounts');
    return { ok: true, account: pub(target) };
  }

  function setPassword(id, pw, opts) {
    if (!(opts && opts.force)) {
      var g = requireAdmin();
      if (!g.ok) return Promise.resolve(g);
    }
    var pv = validatePassword(pw);
    if (!pv.ok) return Promise.resolve(pv);
    var list = readAccounts(), idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) idx = i;
    if (idx < 0) return Promise.resolve({ ok: false, error: '账户不存在' });
    var rec = list[idx], salt = randomSalt();
    return makeHash(pv.password, salt).then(function (h) {
      rec.salt = salt; rec.hash = h.hash; rec.hashAlg = h.alg; rec.legacy = h.legacy;
      rec.updatedAt = Date.now();
      list[idx] = rec;
      writeAccounts(list);
      emit('accounts');
      return { ok: true };
    });
  }
  /* ======================== 登录 / 登出 / 自助修改 ======================== */
  function login(name, password, remember) {
    var rec = findByName(name);
    if (!rec) return Promise.resolve({ ok: false, error: '账户不存在：' + normName(name) });
    return checkHash(rec, String(password == null ? '' : password)).then(function (ok) {
      if (!ok) return { ok: false, error: '密码不正确' };
      setSession(rec, !!remember);
      emit('login');
      return { ok: true, account: pub(rec) };
    });
  }
  function logout() {
    clearSession();
    emit('logout');
    return { ok: true };
  }
  function renameSelf(name) {
    var me = current();
    if (!me) return { ok: false, error: '请先登录账户' };
    return updateAccount(me.id, { name: name }, { force: true });
  }
  function changeOwnPassword(oldPw, newPw) {
    var me = current();
    if (!me) return Promise.resolve({ ok: false, error: '请先登录账户' });
    var pv = validatePassword(newPw);
    if (!pv.ok) return Promise.resolve(pv);
    return checkHash(me, String(oldPw == null ? '' : oldPw)).then(function (ok) {
      if (!ok) return { ok: false, error: '原密码不正确' };
      return setPassword(me.id, pv.password, { force: true });
    });
  }
  function verifyPassword(id, pw) {
    var rec = findById(id);
    if (!rec) return Promise.resolve(false);
    return checkHash(rec, String(pw == null ? '' : pw));
  }

  /* ======================== 备份 / 共享账户表 ======================== */
  function exportJSON() {
    var accounts = readAccounts().map(function (r) {
      return {
        name: r.name, perm: r.perm, salt: r.salt, hash: r.hash, hashAlg: r.hashAlg,
        legacy: r.legacy, note: r.note, isDefault: r.isDefault, createdAt: r.createdAt
      };
    });
    return JSON.stringify({
      version: 1, type: 'leoljs-accounts',
      exportedAt: new Date().toISOString(),
      note: '可另存为 assets/data/accounts.json 作为站点默认账户表（哈希为加盐摘要，但仍建议不要公开真实密码）',
      accounts: accounts
    }, null, 2);
  }
  function importJSON(text, opts) {
    if (!(opts && opts.force)) {
      var g = requireAdmin();
      if (!g.ok) return Promise.resolve(g);
    }
    var data;
    try { data = JSON.parse(String(text || '')); }
    catch (e) { return Promise.resolve({ ok: false, error: 'JSON 解析失败：' + e.message }); }
    var arr = Array.isArray(data) ? data : (data && data.accounts);
    if (!Array.isArray(arr) || !arr.length) return Promise.resolve({ ok: false, error: '未找到 accounts 数组' });
    var out = [];
    arr.forEach(function (r) { var n = normalizeRecord(r); if (n) out.push(n); });
    if (!out.length) return Promise.resolve({ ok: false, error: '账户数据无效' });
    if (countAdmins(out) < 1) return Promise.resolve({ ok: false, error: '账户表必须包含至少 1 个权限 4 的超级管理员' });
    writeAccounts(out);
    emit('accounts');
    return Promise.resolve({ ok: true, count: out.length });
  }
  function resetToDefault(opts) {
    if (!(opts && opts.force)) {
      var g = requireAdmin();
      if (!g.ok) return Promise.resolve(g);
    }
    return makeRecord(DEFAULT_ADMIN.name, DEFAULT_ADMIN.perm, DEFAULT_ADMIN.password, true, '内置默认管理员')
      .then(function (rec) {
        writeAccounts([rec]);
        emit('accounts');
        return { ok: true, account: pub(rec) };
      });
  }
  function storageInfo() {
    return {
      count: readAccounts().length,
      hashAlg: canSubtle() ? 'sha256' : 'fnv1a',
      secure: canSubtle(),
      protocol: location.protocol
    };
  }

  /* ======================== 权限查询 ======================== */
  function permMeta(level) {
    var n = permOf(level);
    return PERMS[isNaN(n) ? 0 : n];
  }
  function can(cap) {
    var need = (CAP_MIN[cap] == null) ? 0 : CAP_MIN[cap];
    return perm() >= need;
  }

  /* ======================== 对外 API ======================== */
  var API = {
    ready: ready,
    root: ROOT,
    url: function (p) { return new URL(p, ROOT).href; },
    PERMS: PERMS,
    CAPS: CAPS,
    CAP_MIN: CAP_MIN,
    LIMITS: { nameMin: NAME_MIN, nameMax: NAME_MAX, passMin: PASS_MIN, passMax: PASS_MAX },
    DEFAULT_ADMIN_NAME: DEFAULT_ADMIN.name,
    ACCOUNTS_FILE: ACCOUNTS_FILE,

    /* 会话与权限 */
    isGuest: function () { return !current(); },
    me: function () { return pub(current()); },
    perm: perm,
    permMeta: permMeta,
    can: can,

    /* 账户查询 */
    list: listAccounts,
    count: function () { return readAccounts().length; },

    /* 账户增删改（权限 4） */
    create: createAccount,
    update: updateAccount,
    remove: removeAccount,
    setPassword: setPassword,
    verifyPassword: verifyPassword,

    /* 登录 / 自助 */
    login: login,
    logout: logout,
    renameSelf: renameSelf,
    changeOwnPassword: changeOwnPassword,

    /* 备份 */
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetToDefault: resetToDefault,
    storageInfo: storageInfo,

    /* 校验与事件 */
    validateName: validateName,
    validatePassword: validatePassword,
    on: on,
    notify: emit
  };

  global.LEOAuth = API;
})(window);
