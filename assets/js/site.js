/* Leo 的小站 · 通用交互
   ------------------------------------------------------------
   移动导航、头部状态、年份、toast、复制。
   首页额外：横向滑动面板、入场动效、实时时钟。
   没有依赖，直接以 <script> 引入。 */

(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 移动端导航 ---------- */

  var header = doc.querySelector("[data-site-header]");
  var navToggle = doc.querySelector("[data-nav-toggle]");
  var nav = doc.getElementById("site-nav");

  function closeNav() {
    if (!header) return;
    header.classList.remove("is-open");
    if (navToggle) navToggle.setAttribute("aria-expanded", "false");
  }

  if (header && navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = header.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeNav();
    });

    doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeNav();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 760) closeNav();
    });
  }

  /* ---------- 头部滚动状态 ---------- */

  if (header) {
    var ticking = false;
    var syncHeader = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
      ticking = false;
    };
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(syncHeader);
        }
      },
      { passive: true }
    );
    syncHeader();
  }

  /* ---------- 年份 ---------- */

  Array.prototype.forEach.call(doc.querySelectorAll("[data-year]"), function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- 导航高亮（非首页手动标记时兜底） ---------- */

  var path = window.location.pathname;
  var hasMarked = doc.querySelector('.site-nav a[aria-current="page"]');

  if (!hasMarked) {
    Array.prototype.forEach.call(doc.querySelectorAll(".site-nav a[data-nav]"), function (link) {
      var key = link.getAttribute("data-nav");
      var active = false;
      if (key === "home") active = path === "/" || /\/index\.html$/.test(path);
      if (key === "pan") active = /\/pan(\/|$)/.test(path);
      if (key === "editor") active = /\/edit(\/|$)|local-editor\.html$/.test(path);
      if (active) link.setAttribute("aria-current", "page");
    });
  }

  /* ---------- Toast ---------- */

  function toast(message, options) {
    options = options || {};
    var stack = doc.querySelector(".toast-stack");
    if (!stack) {
      stack = doc.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("aria-live", "polite");
      doc.body.appendChild(stack);
    }
    var node = doc.createElement("div");
    node.className = "toast" + (options.type ? " is-" + options.type : "");
    node.textContent = message;
    stack.appendChild(node);

    window.requestAnimationFrame(function () {
      node.classList.add("is-visible");
    });

    var duration = options.duration || 2800;
    window.setTimeout(function () {
      node.classList.remove("is-visible");
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 320);
    }, duration);
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var area = doc.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      doc.body.appendChild(area);
      area.select();
      var ok = doc.execCommand("copy");
      doc.body.removeChild(area);
      return ok;
    } catch (error) {
      return false;
    }
  }

  window.LeoUI = { toast: toast, copyText: copyText };

  /* ---------- 时钟与日期 ---------- */

  var clock = doc.querySelector("[data-clock]");
  var dateEl = doc.querySelector("[data-date]");

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function tickClock() {
    if (!clock) return;
    var now = new Date();
    clock.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  if (clock) {
    tickClock();
    window.setInterval(tickClock, 1000);
  }

  if (dateEl) {
    var now = new Date();
    dateEl.textContent =
      now.getFullYear() + "." + pad(now.getMonth() + 1) + "." + pad(now.getDate());
  }

  /* ---------- 入场动效 ---------- */

  var revealItems = Array.prototype.slice.call(doc.querySelectorAll("[data-reveal]"));

  if (revealItems.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach(function (el) {
        el.classList.add("is-in");
      });
    } else {
      revealItems.forEach(function (el, index) {
        if (!el.style.getPropertyValue("--reveal-delay")) {
          el.style.setProperty("--reveal-delay", index * 70 + "ms");
        }
      });
      var revealer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              revealer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
      );
      revealItems.forEach(function (el) {
        revealer.observe(el);
      });
    }
  }

  /* ---------- 首页横向滑动面板 ---------- */

  var deck = doc.querySelector("[data-deck]");
  var viewport = doc.querySelector("[data-deck-viewport]");

  if (deck && viewport) {
    var rail = viewport.querySelector("[data-deck-rail]");
    var panels = Array.prototype.slice.call(viewport.querySelectorAll("[data-deck-panel]"));
    var ticks = Array.prototype.slice.call(deck.querySelectorAll("[data-deck-tick]"));
    var indexEl = deck.querySelector("[data-deck-index]");
    var barEl = deck.querySelector("[data-deck-bar]");
    var behavior = reduceMotion ? "auto" : "smooth";
    var activeIndex = 0;

    function offsetOf(panel) {
      return (
        panel.getBoundingClientRect().left -
        viewport.getBoundingClientRect().left +
        viewport.scrollLeft
      );
    }

    function nearestIndex() {
      var left = viewport.scrollLeft;
      var best = 0;
      var bestDistance = Infinity;
      panels.forEach(function (panel, index) {
        var distance = Math.abs(offsetOf(panel) - left);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    }

    function goTo(index, smooth) {
      var target = panels[Math.max(0, Math.min(panels.length - 1, index))];
      if (!target) return;
      viewport.scrollTo({
        left: offsetOf(target),
        behavior: smooth === false ? "auto" : behavior
      });
    }

    function paint(index) {
      activeIndex = index;
      if (indexEl) indexEl.textContent = pad(index + 1);
      ticks.forEach(function (tick, i) {
        tick.classList.toggle("is-active", i === index);
      });
      panels.forEach(function (panel, i) {
        panel.classList.toggle("is-active", i === index);
      });
      if (barEl) barEl.style.width = ((index + 1) / panels.length) * 100 + "%";
    }

    var raf = null;

    function onScroll() {
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        raf = null;
        var index = nearestIndex();
        if (index !== activeIndex || !panels[index].classList.contains("is-active")) {
          paint(index);
        }
      });
    }

    viewport.addEventListener("scroll", onScroll, { passive: true });

    /* 点击刻度直接跳转 */
    ticks.forEach(function (tick, index) {
      tick.addEventListener("click", function (event) {
        event.preventDefault();
        goTo(index);
      });
    });

    /* 页内锚点：指向面板时改为横向滚动 */
    doc.addEventListener("click", function (event) {
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;
      var id = link.getAttribute("href").slice(1);
      if (!id) return;
      var target = doc.getElementById(id);
      if (!target) return;
      var panel = target.closest("[data-deck-panel]");
      if (!panel) return;
      event.preventDefault();
      goTo(panels.indexOf(panel));
    });

    /* 鼠标滚轮：在首尾之外交还给页面滚动 */
    var wheelLocked = false;
    var wheelTimer = null;

    viewport.addEventListener(
      "wheel",
      function (event) {
        if (event.ctrlKey) return;
        /* 窄屏是原生横向滑动，不劫持纵向滚轮 */
        if (window.innerWidth <= 900) return;
        var delta =
          event.deltaMode === 1 ? event.deltaY * 18 : event.deltaMode === 2 ? event.deltaY * viewport.clientHeight : event.deltaY;
        if (Math.abs(delta) < Math.abs(event.deltaX)) return;

        var index = nearestIndex();
        var next = index + (delta > 0 ? 1 : -1);

        if ((delta > 0 && index >= panels.length - 1) || (delta < 0 && index <= 0)) {
          return; /* 交给页面继续滚动 */
        }

        event.preventDefault();
        if (wheelLocked) return;
        wheelLocked = true;
        goTo(next);
        window.clearTimeout(wheelTimer);
        wheelTimer = window.setTimeout(function () {
          wheelLocked = false;
        }, 420);
      },
      { passive: false }
    );

    /* 鼠标拖拽 */
    var dragging = false;
    var startX = 0;
    var startLeft = 0;
    var moved = false;
    var draggedAt = 0;

    viewport.addEventListener("pointerdown", function (event) {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startLeft = viewport.scrollLeft;
      viewport.classList.add("is-dragging");
      if (viewport.setPointerCapture) viewport.setPointerCapture(event.pointerId);
    });

    viewport.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      var delta = event.clientX - startX;
      if (Math.abs(delta) > 6) moved = true;
      viewport.scrollLeft = startLeft - delta;
    });

    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove("is-dragging");
      if (event && event.pointerId != null && viewport.releasePointerCapture) {
        try {
          viewport.releasePointerCapture(event.pointerId);
        } catch (error) {
          /* 已释放 */
        }
      }
      if (moved) {
        draggedAt = Date.now();
        goTo(nearestIndex());
      }
    }

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    /* 拖拽结束后的 click 不触发链接 */
    viewport.addEventListener(
      "click",
      function (event) {
        if (Date.now() - draggedAt < 220) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );

    /* 键盘 */
    viewport.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(nearestIndex() + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(nearestIndex() - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goTo(panels.length - 1);
      }
    });

    /* 尺寸变化后重新对齐当前面板 */
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        goTo(activeIndex, false);
      }, 160);
    });

    paint(nearestIndex());
  }
})();
