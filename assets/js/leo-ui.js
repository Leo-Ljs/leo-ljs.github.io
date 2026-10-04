/*!
 * Leo 站点 · 共享界面层（导航栏 / 弹窗 / 权限门控 / 账户面板）
 * ---------------------------------------------------------------------------
 * 依赖：leo-auth.js（必须先加载）；leo-site.js 可选（用于导航项配置）。
 * 用法：
 *   LEOUI.mountNav();                        // 自动插入顶部导航
 *   LEOUI.openLoginModal();                  // 登录
 *   LEOUI.toast('已保存', 'ok');              // 轻提示
 *   if (LEOUI.guard('editSite')) { ... }     // 能力门控
 *   LEOUI.panels.accounts(el);               // 在容器内渲染账户管理面板
 */
(function (global) {
  'use strict';

  var A = global.LEOAuth;
  if (!A) { try { console.error('[leo-ui] 需要先加载 leo-auth.js'); } catch (e) { /* ignore */ } return; }

  /* ======================== 基础工具 ======================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function permMeta(n) { return A.PERMS[A.permMeta(n) ? A.permMeta(n).level : 0]; }
  function badge(n) {
    var m = A.permMeta(n);
    return '<span class="leo-perm p' + m.level + '">权限 ' + m.level + ' · ' + esc(m.label) + '</span>';
  }
  function abs(href) {
    if (!href) return '#';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.charAt(0) === '#' || href.charAt(0) === '/') return href;
    try { return A.url(href); } catch (e) { return href; }
  }
  function isActive(href) {
    try {
      var a = new URL(abs(href)).pathname.replace(/index\.html$/, '');
      var b = location.pathname.replace(/index\.html$/, '');
      return a === b;
    } catch (e) { return false; }
  }
  /* 归一化链接以便去重（'./admin/'、'admin'、'admin/index.html' 视为同一入口） */
  function normHref(href) {
    return String(href == null ? '' : href).trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
      .replace(/^\.\//, '').replace(/^\/+/, '')
      .replace(/index\.html$/i, '').replace(/\/+$/, '') + '/';
  }
  function sameHref(a, b) { return normHref(a) === normHref(b); }
  function siteConfig() {
    return (global.LEOSite && global.LEOSite.get) ? global.LEOSite.get() : null;
  }
  function download(filename, text, mime) {
    var blob = new Blob([String(text)], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    try {
      var d = new Date(ts);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    } catch (e) { return '—'; }
  }

  /* ======================== 轻提示 ======================== */
  function toastBox() {
    var box = el('.leo-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'leo-toasts'; document.body.appendChild(box); }
    return box;
  }
  function toast(msg, type, ms) {
    var box = toastBox();
    var t = document.createElement('div');
    t.className = 'leo-toast ' + (type || '');
    t.textContent = msg;
    t.style.transition = 'opacity .3s';
    box.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 320);
    }, ms || 2600);
  }

  /* ======================== 弹窗 ======================== */
  function modalRoot() {
    var root = document.getElementById('leo-modal-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'leo-modal-root';
    root.className = 'leo-modal-mask';
    root.innerHTML =
      '<div class="leo-modal" role="dialog" aria-modal="true">' +
        '<header><div><h3 data-m-title></h3><p class="sub" data-m-sub></p></div>' +
        '<button class="leo-x" data-m-close aria-label="关闭">✕</button></header>' +
        '<div data-m-body></div><footer data-m-foot></footer>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (ev) {
      if (ev.target === root || ev.target.closest('[data-m-close]')) closeModal();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeModal(); });
    return root;
  }
  function openModal(opts) {
    opts = opts || {};
    var root = modalRoot();
    root.querySelector('.leo-modal').className = 'leo-modal' + (opts.wide ? ' wide' : '');
    root.querySelector('[data-m-title]').textContent = opts.title || '';
    var sub = root.querySelector('[data-m-sub]');
    sub.textContent = opts.sub || '';
    root.querySelector('[data-m-body]').innerHTML = opts.html || '';
    root.querySelector('[data-m-foot]').innerHTML = opts.foot || '';
    root.classList.add('open');
    var body = root.querySelector('[data-m-body]');
    if (opts.onMount) opts.onMount(body, root);
    return root;
  }
  function closeModal() {
    var root = document.getElementById('leo-modal-root');
    if (!root) return;
    root.classList.remove('open');
    root.querySelector('[data-m-body]').innerHTML = '';
    root.querySelector('[data-m-foot]').innerHTML = '';
  }
  function msgIn(scope, text, type) {
    var m = el('.leo-msg', scope);
    if (!m) return;
    m.className = 'leo-msg ' + (type || 'err') + (text ? ' show' : '');
    m.textContent = text || '';
  }
  /* ======================== 导航栏 ======================== */
  function navHtml() {
    var cfg = siteConfig();
    var brand = (cfg && cfg.brand) || { name: 'Leo 站点', logo: 'L' };
    var links = (cfg && Array.isArray(cfg.nav) && cfg.nav.length) ? cfg.nav : [
      { label: '主页', href: './', cap: 'viewHome' },
      { label: '游戏中心', href: 'game/', cap: 'viewGames' },
      { label: '音乐播放器', href: 'music/', cap: 'useMusic' }
    ];
    var mine = A.perm() >= 3;
    var linksHtml = links.filter(function (l) {
      /* 权限 ≥3 时下方会自动追加「管理后台」，避免与配置里的同一入口重复展示 */
      if (mine && sameHref(l.href, 'admin/')) return false;
      return A.can(l.cap || 'viewHome');
    }).map(function (l) {
      return '<a href="' + esc(abs(l.href)) + '"' + (isActive(l.href) ? ' class="active"' : '') + '>' + esc(l.label) + '</a>';
    }).join('');
    if (A.perm() >= 3) {
      linksHtml += '<a href="' + esc(abs('admin/')) + '"' + (isActive('admin/') ? ' class="active"' : '') + '>管理后台</a>';
    }
    var me = A.me();
    var right = '';
    if (me) {
      var m = A.permMeta(me.perm);
      right += '<span class="leo-perm p' + m.level + '"><i>P' + m.level + '</i> ' + esc(m.short) + '</span>' +
        '<button class="leo-btn sm" data-nav="account" title="账户中心">' + esc(me.name) + '</button>' +
        '<button class="leo-btn sm ghost" data-nav="logout">退出</button>';
    } else {
      right += '<button class="leo-btn sm primary" data-nav="login">登录</button>';
    }
    right += '<button class="leo-btn sm ghost" data-nav="perms" title="权限说明">权限</button>';
    return '<a class="brand" href="' + esc(abs('./')) + '">' +
        '<span class="logo">' + esc(brand.logo || 'L') + '</span>' +
        '<span class="brand-name">' + esc(brand.name || 'Leo 站点') + '</span></a>' +
      '<button class="leo-nav-toggle" data-nav="toggle" aria-label="打开菜单">☰</button>' +
      '<div class="links">' + linksHtml + '</div>' +
      '<div class="right">' + right + '</div>';
  }

  function mountNav(opts) {
    opts = opts || {};
    var host = opts.host ? el(opts.host) : document.getElementById('leo-nav');
    if (!host) {
      host = document.createElement('nav');
      host.id = 'leo-nav';
      host.className = 'leo-nav';
      document.body.insertBefore(host, document.body.firstChild);
    }
    document.body.classList.add('leo-has-nav');
    function render() { host.innerHTML = navHtml(); }
    render();
    host.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-nav]');
      if (!btn) return;
      var act = btn.getAttribute('data-nav');
      if (act === 'toggle') { host.classList.toggle('open'); return; }
      ev.preventDefault();
      if (act === 'login') { openLoginModal({ onSuccess: opts.onAuth }); return; }
      if (act === 'account') { openAccountModal(); return; }
      if (act === 'logout') {
        A.logout();
        toast('已退出登录', 'ok');
        render();
        if (opts.onAuth) opts.onAuth();
        return;
      }
      if (act === 'perms') { openPermsModal(); return; }
    });
    A.on(function () { render(); });
    global.addEventListener('leosite:change', render);
    return { refresh: render, host: host };
  }

  /* ======================== 权限门控 ======================== */
  function needPerm(cap) { return (A.CAP_MIN[cap] == null) ? 0 : A.CAP_MIN[cap]; }
  function guard(cap, opts) {
    if (A.can(cap)) return true;
    var need = needPerm(cap);
    toast('需要「' + A.PERMS[need].label + '」（权限 ' + need + '）', 'err');
    if (!opts || opts.login !== false) openLoginModal();
    return false;
  }
  function lockHtml(cap) {
    var need = needPerm(cap);
    var m = A.PERMS[need];
    var me = A.me();
    return '<div class="leo-lock"><div class="big">🔒</div>' +
      '<h3>该内容需要「' + esc(m.label) + '」权限</h3>' +
      '<p>' + esc(m.desc) + '（权限 ' + need + '）。' +
      (me ? '当前账户「' + esc(me.name) + '」权限为 ' + me.perm + '。' : '请先登录拥有相应权限的账户。') +
      '</p><div class="ops" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      (me ? '' : '<button class="leo-btn primary" data-lock="login">登录</button>') +
      '<button class="leo-btn" data-lock="perms">查看权限说明</button></div></div>';
  }
  function renderLock(node, cap) {
    if (!node) return;
    node.innerHTML = lockHtml(cap);
    if (node.getAttribute('data-lock-bound')) return;
    node.setAttribute('data-lock-bound', '1');
    node.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-lock]');
      if (!b) return;
      if (b.getAttribute('data-lock') === 'login') openLoginModal();
      else openPermsModal();
    });
  }
  /* ======================== 面板刷新注册表 ======================== */
  /* 所有已挂载面板共用一个 A.on 监听器：登录 / 退出 / 账户变化后自动重绘 */
  var panelRefreshers = [];
  function registerPanel(node, renderFn) {
    panelRefreshers = panelRefreshers.filter(function (r) { return document.body.contains(r.node); });
    var dup = false;
    panelRefreshers.forEach(function (r) { if (r.node === node) { r.render = renderFn; dup = true; } });
    if (!dup) panelRefreshers.push({ node: node, render: renderFn });
  }
  function refreshPanels() {
    panelRefreshers.slice().forEach(function (r) {
      if (!document.body.contains(r.node)) return;
      try { r.render(); } catch (e) { /* 单个面板失败不影响其他面板 */ }
    });
  }
  A.on(refreshPanels);

  /* ======================== 面板：登录 ======================== */
  function loginPanel(node, opts) {
    opts = opts || {};
    node.innerHTML =
      '<div class="leo-msg"></div>' +
      '<form data-form="login">' +
        '<div class="leo-field"><label>账户名称</label>' +
          '<input class="leo-input" name="name" autocomplete="username" placeholder="例如 admin"></div>' +
        '<div class="leo-field"><label>密码</label>' +
          '<input class="leo-input" type="password" name="pw" autocomplete="current-password" placeholder="至少 4 位"></div>' +
        '<label class="leo-check"><input type="checkbox" name="remember"> 记住我（7 天内免登录）</label>' +
        '<div class="ops" style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
          '<button class="leo-btn primary" type="submit">登录</button>' +
          '<button class="leo-btn" type="button" data-login="perms">权限说明</button>' +
        '</div>' +
      '</form>' +
      '<p class="leo-muted" style="font-size:11.5px;line-height:1.8;margin:14px 0 0">' +
      '默认管理员：<b>admin / admin</b>（权限 4）。本站为纯静态页面，账户数据保存在当前浏览器（localStorage），不会上传到任何服务器。</p>';
    node.querySelector('[data-login="perms"]').addEventListener('click', function () { openPermsModal(); });
    var form = node.querySelector('[data-form="login"]');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var name = form.elements.name.value, pw = form.elements.pw.value;
      btn.disabled = true;
      A.login(name, pw, form.elements.remember.checked).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { msgIn(node, res.error, 'err'); return; }
        toast('欢迎回来，' + res.account.name + '（权限 ' + res.account.perm + '）', 'ok');
        closeModal();
        if (opts.onSuccess) opts.onSuccess(res.account);
      }).catch(function (e) { btn.disabled = false; msgIn(node, '登录失败：' + e, 'err'); });
    });
  }

  /* ======================== 面板：权限说明 ======================== */
  function permsPanel(node) {
    registerPanel(node, function () { permsPanel(node); });
    var me = A.perm(), html = '';
    A.PERMS.forEach(function (p) {
      var unlocked = me >= p.level;
      html += '<div class="leo-edit-item"><div class="head">' +
        '<span class="name">' + badge(p.level) + '</span>' +
        '<span class="leo-muted" style="font-size:12px">' + (unlocked ? '✅ 已解锁' : '未解锁') + '</span></div>' +
        '<p class="leo-muted" style="font-size:12.5px;line-height:1.8;margin:0 0 10px">' + esc(p.desc) + '</p>' +
        '<div class="leo-kv">' + A.CAPS.filter(function (c) { return c.perm === p.level; })
          .map(function (c) { return '<span>· ' + esc(c.label) + '</span>'; }).join('') + '</div></div>';
    });
    node.innerHTML = '<div class="leo-msg info show">当前权限：' + badge(me) + ' —— ' + esc(A.permMeta(me).desc) + '</div>' + html +
      '<p class="leo-muted" style="font-size:11.5px;line-height:1.8">提示：权限是累加的，高权限自动拥有低权限的全部能力；权限 3 及以上可进入管理后台（只读账户），权限 4 可编辑主页内容、游戏目录并管理账户。</p>';
  }
  /* ======================== 面板：账户中心（自助） ======================== */
  function accountPanel(node) {
    function render() {
      var me = A.me();
      if (!me) { node.innerHTML = '<p class="leo-empty">当前未登录，请先登录账户。</p>'; return; }
      node.innerHTML =
        '<div class="leo-kv" style="margin-bottom:14px">' +
          '<span><b>账户</b>' + esc(me.name) + '</span>' + badge(me.perm) +
          '<span><b>创建于</b>' + fmtTime(me.createdAt) + '</span>' +
          (me.isDefault ? '<span class="leo-perm p4">默认账户</span>' : '') +
        '</div>' +
        '<div class="leo-msg"></div>' +
        '<div class="leo-tabs"><button class="leo-tab active" data-tab="name">修改名称</button>' +
        '<button class="leo-tab" data-tab="pw">修改密码</button></div>' +
        '<div data-pane="name"><form data-form="name">' +
          '<div class="leo-field"><label>新的账户名称（2-20 个字符，不可与其他账户重名）</label>' +
          '<input class="leo-input" name="name" value="' + esc(me.name) + '"></div>' +
          '<button class="leo-btn primary" type="submit">保存名称</button>' +
        '</form></div>' +
        '<div data-pane="pw" class="leo-hidden"><form data-form="pw">' +
          '<div class="leo-field"><label>当前密码</label><input class="leo-input" type="password" name="old"></div>' +
          '<div class="leo-field"><label>新密码（4-64 位）</label><input class="leo-input" type="password" name="next"></div>' +
          '<div class="leo-field"><label>确认新密码</label><input class="leo-input" type="password" name="again"></div>' +
          '<button class="leo-btn primary" type="submit">修改密码</button>' +
        '</form></div>' +
        '<div class="leo-divider"></div>' +
        '<div class="ops" style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="leo-btn" data-self="perms">查看权限说明</button>' +
          '<button class="leo-btn danger" data-self="logout">退出登录</button>' +
        '</div>';

      node.querySelectorAll('.leo-tab').forEach(function (t) {
        t.addEventListener('click', function () {
          node.querySelectorAll('.leo-tab').forEach(function (x) { x.classList.remove('active'); });
          t.classList.add('active');
          node.querySelectorAll('[data-pane]').forEach(function (p) {
            p.classList[p.getAttribute('data-pane') === t.getAttribute('data-tab') ? 'remove' : 'add']('leo-hidden');
          });
        });
      });
      node.querySelector('[data-self="perms"]').addEventListener('click', function () { openPermsModal(); });
      node.querySelector('[data-self="logout"]').addEventListener('click', function () {
        A.logout();
        toast('已退出登录', 'ok');
        closeModal();
      });
      node.querySelector('[data-form="name"]').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var res = A.renameSelf(ev.target.elements.name.value);
        if (!res.ok) { msgIn(node, res.error, 'err'); return; }
        var shown = res.account.name;
        toast('名称已更新', 'ok');
        render();
        msgIn(node, '名称已更新为「' + shown + '」', 'ok');
      });
      node.querySelector('[data-form="pw"]').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = ev.target.elements;
        if (f.next.value !== f.again.value) { msgIn(node, '两次输入的新密码不一致', 'err'); return; }
        A.changeOwnPassword(f.old.value, f.next.value).then(function (res) {
          if (!res.ok) { msgIn(node, res.error, 'err'); return; }
          msgIn(node, '密码已修改，下次登录请使用新密码', 'ok');
          toast('密码已修改', 'ok');
          ev.target.reset();
        });
      });
    }
    registerPanel(node, render);
    render();
    return { refresh: render };
  }
  /* ======================== 面板：账户管理（权限 4） ======================== */
  function accountsPanel(node) {
    var canManage = A.can('manageAccounts');

    function permOptions(sel) {
      return A.PERMS.map(function (p) {
        return '<option value="' + p.level + '"' + (p.level === sel ? ' selected' : '') + '>' +
          p.level + ' · ' + esc(p.label) + '</option>';
      }).join('');
    }

    function addFormHtml() {
      return '<div class="leo-edit-item"><div class="head"><span class="name">新增账户</span></div>' +
        '<form data-form="add"><div class="leo-row">' +
          '<div class="leo-field"><label>账户名称</label><input class="leo-input" name="name" placeholder="2-20 个字符"></div>' +
          '<div class="leo-field"><label>初始密码</label><input class="leo-input" type="password" name="password" placeholder="4-64 位"></div>' +
        '</div><div class="leo-row">' +
          '<div class="leo-field"><label>权限等级</label><select class="leo-select" name="perm">' + permOptions(2) + '</select></div>' +
          '<div class="leo-field"><label>备注（可选）</label><input class="leo-input" name="note" placeholder="例如：家人账号"></div>' +
        '</div><button class="leo-btn primary" type="submit">创建账户</button></form></div>';
    }

    function render() {
      if (!A.can('viewAccounts')) { renderLock(node, 'viewAccounts'); return; }
      canManage = A.can('manageAccounts');
      var me = A.me();
      var rows = A.list().map(function (a) {
        var isMe = me && me.id === a.id;
        return '<tr data-row="' + esc(a.id) + '">' +
          '<td><input class="leo-input" data-f="name" value="' + esc(a.name) + '"' + (canManage ? '' : ' disabled') + '></td>' +
          '<td>' + (canManage
            ? '<select class="leo-select" data-f="perm">' + permOptions(a.perm) + '</select>'
            : badge(a.perm)) + '</td>' +
          '<td class="mono">' + fmtTime(a.createdAt) + '</td>' +
          '<td>' + (a.isDefault ? '<span class="leo-perm p4">默认</span> ' : '') +
            (isMe ? '<span class="leo-perm p2">当前会话</span>' : '') + '</td>' +
          '<td class="ops">' + (canManage
            ? '<button class="leo-btn sm primary" data-a="save">保存</button> ' +
              '<button class="leo-btn sm" data-a="pw">改密</button> ' +
              '<button class="leo-btn sm danger" data-a="del">删除</button>'
            : '<span class="leo-muted">只读</span>') + '</td></tr>';
      }).join('');

      node.innerHTML =
        '<div class="leo-msg"></div>' +
        (canManage ? addFormHtml()
          : '<div class="leo-msg info show">只读模式（内容审核员）：可以查看账户并导出快照，新增 / 修改 / 删除账户需要权限 4。</div>') +
        '<div class="leo-table-wrap"><table class="leo-table"><thead><tr>' +
          '<th>名称</th><th>权限</th><th>创建时间</th><th>标记</th><th>操作</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="leo-muted">暂无账户</td></tr>') + '</tbody></table></div>' +
        '<div class="leo-divider"></div>' +
        '<div class="leo-editor-bar"><span class="title">账户表备份（可另存为 assets/data/accounts.json）</span></div>' +
        '<div class="ops" style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="leo-btn" data-all="export">导出 JSON</button>' +
          (canManage ? '<button class="leo-btn" data-all="import">导入 JSON</button>' +
            '<button class="leo-btn danger" data-all="reset">恢复默认 admin/admin</button>' : '') +
          '<button class="leo-btn ghost" data-all="refresh">刷新</button>' +
        '</div>' +
        '<p class="leo-muted" style="font-size:11.5px;line-height:1.9;margin-top:12px">' +
        '账户保存在当前浏览器的 localStorage；导出的 JSON 可提交为 <code>assets/data/accounts.json</code>，' +
        '站点首次加载时会读取它作为默认账户表。哈希为加盐摘要，但仍请不要在公开仓库中泄露真实密码。</p>';

      wire();
    }

    function wire() {
      var add = node.querySelector('[data-form="add"]');
      if (add) add.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = ev.target.elements;
        A.create({
          name: f.name.value, password: f.password.value,
          perm: parseInt(f.perm.value, 10), note: f.note.value
        }).then(function (res) {
          if (!res.ok) { msgIn(node, res.error, 'err'); return; }
          toast('已创建账户「' + res.account.name + '」', 'ok');
          flash('已创建账户「' + res.account.name + '」（权限 ' + res.account.perm + '）');
        });
      });

      var tbody = node.querySelector('tbody');
      if (tbody) tbody.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-a]');
        if (!btn) return;
        var tr = btn.closest('tr');
        var id = tr.getAttribute('data-row');
        var found = A.list().filter(function (a) { return a.id === id; });
        var acct = found[0] || { id: id, name: id };
        var act = btn.getAttribute('data-a');
        if (act === 'save') {
          var patch = {};
          var nameInput = tr.querySelector('[data-f="name"]');
          var permSel = tr.querySelector('[data-f="perm"]');
          if (nameInput) patch.name = nameInput.value;
          if (permSel) patch.perm = parseInt(permSel.value, 10);
          var res = A.update(id, patch);
          if (!res.ok) { msgIn(node, res.error, 'err'); return; }
          toast('已保存「' + res.account.name + '」', 'ok');
          flash('已保存「' + res.account.name + '」（权限 ' + res.account.perm + '）');
          return;
        }
        if (act === 'pw') { passwordModal(acct); return; }
        if (act === 'del') {
          if (!global.confirm('确定删除账户「' + acct.name + '」？该操作不可撤销。')) return;
          var r = A.remove(id);
          if (!r.ok) { msgIn(node, r.error, 'err'); return; }
          toast('已删除「' + acct.name + '」', 'ok');
          flash('已删除账户「' + acct.name + '」');
        }
      });

      node.querySelectorAll('[data-all]').forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-all');
          if (act === 'export') { download('leoljs-accounts.json', A.exportJSON()); toast('已导出账户表 JSON', 'ok'); return; }
          if (act === 'refresh') { render(); toast('已刷新账户列表', 'ok'); return; }
          if (act === 'import') { importModal(flash); return; }
          if (act === 'reset') {
            if (!global.confirm('确定恢复默认账户表？现有账户将被全部清除，仅保留 admin/admin（权限 4）。')) return;
            A.resetToDefault().then(function (res) {
              flash(res.ok ? '已恢复默认账户 admin/admin' : res.error, res.ok ? 'ok' : 'err');
            });
          }
        });
      });
    }

    function passwordModal(acct) {
      openModal({
        title: '修改密码 · ' + acct.name,
        sub: '为该账户设置新密码（4-64 位），保存后立即生效',
        html: '<div class="leo-msg"></div><form data-form="pw">' +
          '<div class="leo-field"><label>新密码</label><input class="leo-input" type="password" name="pw"></div>' +
          '<div class="leo-field"><label>确认新密码</label><input class="leo-input" type="password" name="again"></div>' +
          '<footer style="display:flex;justify-content:flex-end;gap:9px">' +
          '<button class="leo-btn" type="button" data-m-close>取消</button>' +
          '<button class="leo-btn primary" type="submit">保存密码</button></footer></form>',
        onMount: function (body) {
          body.querySelector('form').addEventListener('submit', function (ev) {
            ev.preventDefault();
            var f = ev.target.elements;
            if (f.pw.value !== f.again.value) { msgIn(body, '两次输入的密码不一致', 'err'); return; }
            A.setPassword(acct.id, f.pw.value).then(function (res) {
              if (!res.ok) { msgIn(body, res.error, 'err'); return; }
              closeModal();
              toast('「' + acct.name + '」的密码已更新', 'ok');
              flash('已更新「' + acct.name + '」的密码');
            });
          });
        }
      });
    }

    function importModal(flashFn) {
      openModal({
        title: '导入账户表 JSON',
        sub: '粘贴导出的 JSON（需包含至少 1 个权限 4 的账户）；导入会覆盖当前账户表。',
        wide: true,
        html: '<div class="leo-msg"></div>' +
          '<div class="leo-field"><label>账户表 JSON</label>' +
          '<textarea class="leo-textarea" style="min-height:220px;font-family:Consolas,Menlo,monospace"></textarea></div>' +
          '<footer style="display:flex;justify-content:flex-end;gap:9px">' +
          '<button class="leo-btn" type="button" data-m-close>取消</button>' +
          '<button class="leo-btn primary" data-do="import">导入并覆盖</button></footer>',
        onMount: function (body) {
          body.querySelector('[data-do="import"]').addEventListener('click', function () {
            A.importJSON(body.querySelector('textarea').value).then(function (res) {
              if (!res.ok) { msgIn(body, res.error, 'err'); return; }
              closeModal();
              flashFn('已导入 ' + res.count + ' 个账户');
            });
          });
        }
      });
    }

    registerPanel(node, render);

    function flash(text, type) { render(); msgIn(node, text, type || 'ok'); }

    render();
    return { refresh: render };
  }

  /* ======================== 弹窗入口 ======================== */
  function openLoginModal(opts) {
    openModal({
      title: '登录账户',
      sub: '登录后按权限等级开放对应功能（权限 0-4 为累加关系）',
      onMount: function (body) { loginPanel(body, opts); }
    });
  }
  function openAccountModal() {
    if (!A.me()) { openLoginModal(); return; }
    openModal({
      title: '账户中心',
      sub: '修改自己的账户名称与登录密码',
      onMount: function (body) { accountPanel(body); }
    });
  }
  function openAccountsModal() {
    openModal({
      title: '账户管理',
      sub: '新增 / 修改 / 删除账户与权限等级（需要权限 4）',
      wide: true,
      onMount: function (body) { accountsPanel(body); }
    });
  }
  function openPermsModal() {
    openModal({
      title: '权限等级说明',
      sub: '权限 0-4 为累加关系，等级越高可用的能力越多',
      wide: true,
      onMount: function (body) { permsPanel(body); }
    });
  }

  /* ======================== 对外 API ======================== */
  function gate(cap, node) {
    if (A.can(cap)) return true;
    renderLock(node, cap);
    return false;
  }

  global.LEOUI = {
    /* 基础 */
    toast: toast, esc: esc, badge: badge, download: download, fmtTime: fmtTime,
    abs: abs, isActive: isActive, siteConfig: siteConfig,
    /* 弹窗 */
    openModal: openModal, closeModal: closeModal, msg: msgIn,
    /* 导航与门控 */
    mountNav: mountNav, guard: guard, gate: gate, needPerm: needPerm,
    lockHtml: lockHtml, renderLock: renderLock,
    can: function (cap) { return A.can(cap); },
    /* 具体弹窗 */
    openLoginModal: openLoginModal, openAccountModal: openAccountModal,
    openAccountsModal: openAccountsModal, openPermsModal: openPermsModal,
    /* 面板（供 admin 页面内嵌） */
    panels: { login: loginPanel, account: accountPanel, accounts: accountsPanel, perms: permsPanel }
  };
})(window);
