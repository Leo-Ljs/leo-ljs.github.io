/* 站点通用交互：移动导航、滚动状态、年份、Toast 与复制工具 */
(function () {
  "use strict";

  var header = document.querySelector("[data-site-header]");
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.getElementById("site-nav");

  function setMenu(open) {
    if (!header || !toggle) return;
    header.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
  }

  if (header && toggle && nav) {
    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      setMenu(!header.classList.contains("is-open"));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setMenu(false);
    });

    document.addEventListener("click", function (event) {
      if (!header.classList.contains("is-open")) return;
      if (!header.contains(event.target)) setMenu(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && header.classList.contains("is-open")) {
        setMenu(false);
        toggle.focus();
      }
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 760) setMenu(false);
    });
  }

  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  document.querySelectorAll("[data-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  /* 当前导航高亮：pathname 以 /pan/ 开头时点亮网盘 */
  var path = location.pathname.replace(/\/index\.html$/, "/");
  document.querySelectorAll("[data-nav]").forEach(function (link) {
    var key = link.getAttribute("data-nav");
    var active = false;
    if (key === "home") active = path === "/" || path === "";
    if (key === "pan") active = path === "/pan" || path.indexOf("/pan/") === 0;
    if (active) link.setAttribute("aria-current", "page");
  });

  function toastContainer() {
    var box = document.querySelector(".toast-stack");
    if (!box) {
      box = document.createElement("div");
      box.className = "toast-stack";
      box.setAttribute("aria-live", "polite");
      box.setAttribute("aria-atomic", "false");
      document.body.appendChild(box);
    }
    return box;
  }

  function toast(message, options) {
    var opts = options || {};
    var node = document.createElement("div");
    node.className = "toast" + (opts.type ? " is-" + opts.type : "");
    node.setAttribute("role", "status");
    node.textContent = String(message);
    toastContainer().appendChild(node);
    requestAnimationFrame(function () {
      node.classList.add("is-visible");
    });
    var timer = window.setTimeout(dismiss, opts.duration || 3200);

    function dismiss() {
      window.clearTimeout(timer);
      node.classList.remove("is-visible");
      window.setTimeout(function () {
        node.remove();
      }, 220);
    }

    node.addEventListener("click", dismiss);
    return dismiss;
  }

  function copyText(text) {
    var value = String(text == null ? "" : text);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, value.length);
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (error) {
        ok = false;
      }
      area.remove();
      if (ok) resolve();
      else reject(new Error("浏览器不允许自动复制，请手动选择文本。"));
    });
  }

  window.LeoUI = {
    toast: toast,
    copyText: copyText
  };
})();
