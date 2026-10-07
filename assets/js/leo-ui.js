/*!
 * Leo 站点 · 共享界面层（导航栏 / 弹窗 / 轻提示 / 小工具）
 * ---------------------------------------------------------------------------
 * 本站没有账户、登录与权限系统：所有页面与编辑器对任何访问者都是公开的。
 * 本文件只提供界面零件，不做任何准入判断。
 * 依赖：无（leo-site.js 可选，用于读取导航项配置）。
 * 用法：
 *   LEOUI.mountNav({ host: '#leo-nav' });     // 自动插入顶部导航
 *   LEOUI.toast('已保存', 'ok');               // 轻提示
 *   LEOUI.abs('game/');                        // 解析为站点根路径下的绝对地址
 *   LEOUI.download('site.json', jsonText);     // 触发浏览器下载
 *   LEOUI.openModal({ title: '标题', html: '...' });
 */
(function (global) {
  'use strict';

  /* 站点根路径：本脚本位于 <根>/assets/js/ 下 */
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || (function () {
    var list = document.getElementsByTagName('script');
    for (var i = list.length - 1; i >= 0; i--) {
      if (/assets\/js\/leo-ui\.js(\?|#|$)/.test(list[i].src || '')) return list[i].src;
    }
    return location.href;
  })();
  var ROOT;
  try { ROOT = new URL('../../', SCRIPT_URL).href; } catch (e) { ROOT = './'; }

  /* ======================== 基础工具 ======================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function url(href) {
    try { return new URL(href, ROOT).href; } catch (e) { return String(href || ''); }
  }
  function abs(href) {
    if (!href) return '#';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.charAt(0) === '#' || href.charAt(0) === '/') return href;
    return url(href);
  }
  function isActive(href) {
    try {
      var a = new URL(abs(href)).pathname.replace(/index\.html$/, '');
      var b = location.pathname.replace(/index\.html$/, '');
      return a === b;
    } catch (e) { return false; }
  }
  function siteConfig() {
    return (global.LEOSite && global.LEOSite.get) ? global.LEOSite.get() : null;
  }
  function download(filename, text, mime) {
    var blob = new Blob([String(text)], { type: (mime || 'application/json') + ';charset=utf-8' });
    var link = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = link;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(link); a.remove(); }, 800);
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
    root.querySelector('[data-m-sub]').textContent = opts.sub || '';
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
/* ======================== 顶部导航 ======================== */
  var FALLBACK_NAV = [
    { label: '主页', href: './' },
    { label: '游戏中心', href: 'game/' },
    { label: '音乐播放器', href: 'music/' },
    { label: '管理中心', href: 'admin/' }
  ];
  function navItems() {
    var cfg = siteConfig();
    var list = (cfg && Array.isArray(cfg.nav) && cfg.nav.length) ? cfg.nav : FALLBACK_NAV;
    var seen = {};
    return list.filter(function (l) {
      var href = String((l && l.href) || '');
      if (!href || seen[href]) return false;
      seen[href] = 1;
      return true;
    });
  }
  function navHtml() {
    var cfg = siteConfig();
    var brand = (cfg && cfg.brand) || { name: 'Leo 站点', logo: 'L' };
    var linksHtml = navItems().map(function (l) {
      return '<a href="' + esc(abs(l.href)) + '"' + (isActive(l.href) ? ' class="active"' : '') + '>' +
        esc(l.label || l.href) + '</a>';
    }).join('');
    return '<a class="brand" href="' + esc(abs('./')) + '">' +
        '<span class="logo">' + esc(brand.logo || 'L') + '</span>' +
        '<span class="brand-name">' + esc(brand.name || 'Leo 站点') + '</span></a>' +
      '<button class="leo-nav-toggle" data-nav="toggle" aria-label="打开菜单">☰</button>' +
      '<div class="links">' + linksHtml + '</div>';
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
      if (btn && btn.getAttribute('data-nav') === 'toggle') host.classList.toggle('open');
    });
    global.addEventListener('leosite:change', render);
    return { refresh: render, host: host };
  }

  /* ======================== 对外 API ======================== */
  global.LEOUI = {
    root: ROOT,
    url: url,
    esc: esc,
    abs: abs,
    isActive: isActive,
    siteConfig: siteConfig,
    download: download,
    fmtTime: fmtTime,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    msg: msgIn,
    mountNav: mountNav
  };


})(window);
