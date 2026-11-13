/* global PanData */
(function () {
  "use strict";

  var PAGE_SIZE = 200;
  var SEARCH_LIMIT = 300;
  var VIEW_KEY = "leoljs.pan.view";
  var SORT_KEY = "leoljs.pan.sort";
  var DIR_KEY = "leoljs.pan.dir";

  var state = {
    data: null,
    stats: null,
    index: null,
    routeId: "root",
    query: "",
    sort: "name",
    direction: "asc",
    view: "list",
    limit: PAGE_SIZE,
    expanded: Object.create(null),
    dialogNode: null,
    searchTimer: 0,
    loading: false
  };

  var dom = {};
  var svgNS = "http://www.w3.org/2000/svg";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(svgNS, "use");
    use.setAttribute("href", "#" + name);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function readPref(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writePref(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* localStorage 不可用时静默忽略 */
    }
  }

  function cacheDom() {
    dom.title = document.getElementById("pan-title");
    dom.notice = document.getElementById("pan-notice");
    dom.updated = document.getElementById("pan-updated");
    dom.tree = document.getElementById("pan-tree");
    dom.side = document.getElementById("pan-side");
    dom.sideClose = document.getElementById("pan-side-close");
    dom.sideBackdrop = document.getElementById("pan-side-backdrop");
    dom.treeToggle = document.getElementById("pan-tree-toggle");
    dom.breadcrumb = document.getElementById("pan-breadcrumb");
    dom.search = document.getElementById("pan-search");
    dom.sort = document.getElementById("pan-sort");
    dom.sortDir = document.getElementById("pan-sort-dir");
    dom.view = document.getElementById("pan-view");
    dom.viewIcon = dom.view ? dom.view.querySelector("[data-view-icon] use") : null;
    dom.currentTitle = document.getElementById("pan-current-title");
    dom.currentSub = document.getElementById("pan-current-sub");
    dom.count = document.getElementById("pan-count");
    dom.status = document.getElementById("pan-status");
    dom.loading = document.getElementById("pan-loading");
    dom.error = document.getElementById("pan-error");
    dom.content = document.getElementById("pan-content");
    dom.more = document.getElementById("pan-more");
    dom.moreBtn = document.getElementById("pan-more-btn");
    dom.moreNote = document.getElementById("pan-more-note");
    dom.dialog = document.getElementById("file-dialog");
    dom.dialogType = document.getElementById("file-dialog-type");
    dom.dialogIcon = document.getElementById("file-dialog-icon");
    dom.dialogTitle = document.getElementById("file-dialog-title");
    dom.dialogPath = document.getElementById("file-dialog-path");
    dom.dialogDesc = document.getElementById("file-dialog-desc");
    dom.dialogSize = document.getElementById("file-dialog-size");
    dom.dialogDate = document.getElementById("file-dialog-date");
    dom.dialogKind = document.getElementById("file-dialog-kind");
    dom.dialogCode = document.getElementById("file-dialog-code");
    dom.dialogCodeValue = document.getElementById("file-dialog-code-value");
    dom.dialogCopy = document.getElementById("file-dialog-copy");
    dom.dialogUrl = document.getElementById("file-dialog-url");
    dom.dialogDownload = document.getElementById("file-dialog-download");
  }

  function restorePreferences() {
    var view = readPref(VIEW_KEY);
    var sort = readPref(SORT_KEY);
    var dir = readPref(DIR_KEY);
    if (view === "grid" || view === "list") state.view = view;
    if (sort === "name" || sort === "size" || sort === "updated") state.sort = sort;
    if (dir === "asc" || dir === "desc") state.direction = dir;

    if (dom.sort) dom.sort.value = state.sort;
    updateViewButton();
    updateSortDirection();
  }

  function updateViewButton() {
    if (!dom.view) return;
    var isGrid = state.view === "grid";
    dom.view.setAttribute("aria-pressed", isGrid ? "true" : "false");
    dom.view.setAttribute("aria-label", isGrid ? "切换为列表视图" : "切换为网格视图");
    dom.view.setAttribute("title", isGrid ? "切换为列表视图" : "切换为网格视图");
    if (dom.viewIcon) dom.viewIcon.setAttribute("href", isGrid ? "#i-list" : "#i-grid");
    if (dom.content) dom.content.classList.toggle("is-grid", isGrid);
  }

  function updateSortDirection() {
    if (!dom.sortDir) return;
    var desc = state.direction === "desc";
    dom.sortDir.classList.toggle("is-desc", desc);
    dom.sortDir.setAttribute("aria-label", desc ? "当前降序，点击切换为升序" : "当前升序，点击切换为降序");
    dom.sortDir.setAttribute("title", desc ? "当前降序，点击切换为升序" : "当前升序，点击切换为降序");
  }

  function setStatus(text) {
    if (dom.status) dom.status.textContent = text || "";
  }

  function showLoading() {
    if (dom.loading) dom.loading.hidden = false;
    if (dom.content) dom.content.hidden = true;
    if (dom.more) dom.more.hidden = true;
    if (dom.error) dom.error.hidden = true;
  }

  function hideLoading() {
    if (dom.loading) dom.loading.hidden = true;
  }

  function showError(title, message, actions) {
    hideLoading();
    if (dom.content) dom.content.hidden = true;
    if (dom.more) dom.more.hidden = true;
    if (!dom.error) return;
    clear(dom.error);
    dom.error.hidden = false;
    dom.error.className = "pan-message is-error";

    var heading = el("strong", null, title);
    dom.error.appendChild(heading);
    if (message) {
      var paragraph = el("p", null, message);
      dom.error.appendChild(paragraph);
    }
    if (actions && actions.length) {
      var actionRow = el("div", "pan-message-actions");
      actions.forEach(function (action) {
        var control;
        if (action.href) {
          control = el("a", "btn btn-ghost btn-sm", action.label);
          control.href = action.href;
        } else {
          control = el("button", "btn btn-soft btn-sm", action.label);
          control.type = "button";
          if (typeof action.onClick === "function") control.addEventListener("click", action.onClick);
        }
        actionRow.appendChild(control);
      });
      dom.error.appendChild(actionRow);
    }
    setStatus("");
    if (dom.currentTitle) dom.currentTitle.textContent = "读取失败";
    if (dom.currentSub) dom.currentSub.textContent = "";
    if (dom.count) dom.count.hidden = true;
  }

  function dataOptions() {
    return {
      origin: window.location.origin,
      siteHosts: [window.location.hostname]
    };
  }

  function loadData() {
    if (state.loading) return;
    state.loading = true;
    showLoading();
    setStatus("正在读取目录…");
    if (dom.currentTitle) dom.currentTitle.textContent = "正在读取…";
    if (dom.currentSub) dom.currentSub.textContent = "";
    if (dom.count) dom.count.hidden = true;
    if (dom.error) dom.error.hidden = true;

    var url = new URL("data.json", window.location.href);
    url.hash = "";

    fetch(url.href, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);
        return response.text();
      })
      .then(function (text) {
        var result = PanData.parseJson(text, dataOptions());
        if (!result.ok) {
          var detail = result.error || "数据格式不正确。";
          var errorText = detail;
          if (result.errors && result.errors.length > 1) {
            errorText += " 共有 " + result.errors.length + " 处问题，请用编辑器检查。";
          }
          showError("目录数据暂时不可用", errorText, [
            { label: "重新读取", onClick: loadData },
            { label: "打开编辑器", href: "/pan/edit/" }
          ]);
          return;
        }
        state.data = result.data;
        state.stats = result.stats;
        state.index = buildIndex(result.data.tree);
        state.loading = false;
        hideLoading();
        if (dom.error) dom.error.hidden = true;
        applyDataHead();
        routeFromHash(true);
      })
      .catch(function (error) {
        state.loading = false;
        showError("读不到目录文件", "无法加载 pan/data.json。请确认文件存在，并检查网络后重试。", [
          { label: "重试", onClick: loadData },
          { label: "回到首页", href: "/" }
        ]);
        setStatus(error && error.message ? error.message : "网络请求失败。");
      });
  }

  function applyDataHead() {
    var data = state.data;
    if (!data) return;
    document.title = (data.title || "网盘") + " · Leo 的小站";
    if (dom.title) dom.title.textContent = data.title || "网盘";
    if (dom.notice) {
      dom.notice.textContent = data.notice || "这里放一些整理好的资料。文件都存放在外部网盘，点击下载会离开本站。";
    }
    if (dom.updated) {
      dom.updated.textContent = data.updatedAt ? "目录更新于 " + PanData.formatDate(data.updatedAt) : "";
    }
  }

  function buildIndex(tree) {
    var map = Object.create(null);
    PanData.flattenTree(tree).forEach(function (entry) {
      map[entry.node.id] = entry;
    });
    return map;
  }

  function isRoot() {
    return state.routeId === "root" || state.routeId == null;
  }

  function routeFromHash(initial) {
    var raw = window.location.hash || "";
    var id = "root";
    if (raw && raw !== "#" && raw !== "#/") {
      var match = raw.match(/^#\/folder\/(.+)$/);
      if (!match) {
        id = null;
      } else {
        try {
          id = decodeURIComponent(match[1]);
        } catch (error) {
          id = null;
        }
      }
    }

    state.routeId = id;
    state.limit = PAGE_SIZE;
    closeSidebar(false);
    if (state.query) {
      state.query = "";
      if (dom.search) dom.search.value = "";
    }
    expandAncestors();
    renderTree();
    renderRoute(initial);
  }

  function expandAncestors() {
    if (isRoot() || !state.index || !state.index[state.routeId]) return;
    state.index[state.routeId].path.forEach(function (node) {
      if (node && node.type === "folder") state.expanded[node.id] = true;
    });
  }

  function renderRoute() {
    if (!state.data) return;
    if (state.routeId === null) {
      renderMissingFolder();
      return;
    }
    if (!isRoot()) {
      var entry = state.index[state.routeId];
      if (!entry || entry.node.type !== "folder") {
        renderMissingFolder();
        return;
      }
    }
    renderBreadcrumb();
    renderCurrent();
  }

  function renderMissingFolder() {
    if (dom.breadcrumb) {
      clear(dom.breadcrumb);
      var rootLink = el("a", "pan-crumb", "全部文件");
      rootLink.href = "#/";
      dom.breadcrumb.appendChild(rootLink);
      dom.breadcrumb.appendChild(el("span", "pan-crumb-sep", "/"));
      dom.breadcrumb.appendChild(el("span", "pan-crumb is-current", "找不到文件夹"));
    }
    if (dom.currentTitle) dom.currentTitle.textContent = "找不到这个文件夹";
    if (dom.currentSub) dom.currentSub.textContent = "它可能已经被移动、重命名或删除。";
    if (dom.count) dom.count.hidden = true;
    setStatus("");
    if (dom.content) {
      dom.content.hidden = false;
      clear(dom.content);
      dom.content.appendChild(emptyState("folder", "这里没有对应的文件夹", "回到全部文件，或者打开编辑器检查目录结构。", {
        label: "回到全部文件",
        href: "#/"
      }));
    }
    if (dom.more) dom.more.hidden = true;
  }

  function folderChildren() {
    if (isRoot()) return state.data.tree;
    var entry = state.index[state.routeId];
    return entry && entry.node.children ? entry.node.children : [];
  }

  function currentFolder() {
    if (isRoot()) return null;
    var entry = state.index[state.routeId];
    return entry ? entry.node : null;
  }

  function renderCurrent() {
    if (!state.data) return;
    if (state.query) {
      renderSearchResults();
      return;
    }

    var folder = currentFolder();
    var children = folderChildren();
    var sorted = PanData.sortNodes(children, state.sort, state.direction);
    var folders = 0;
    var files = 0;
    children.forEach(function (node) {
      if (node.type === "folder") folders += 1;
      else files += 1;
    });

    if (dom.currentTitle) dom.currentTitle.textContent = folder ? folder.name : "全部文件";
    if (dom.currentSub) {
      var pieces = [];
      if (folder && folder.description) pieces.push(folder.description);
      pieces.push(folders + " 个文件夹 · " + files + " 个文件");
      dom.currentSub.textContent = pieces.join(" · ");
    }
    if (dom.count) {
      dom.count.hidden = false;
      dom.count.textContent = children.length + " 项";
    }

    var visible = sorted.slice(0, state.limit);
    setStatus(
      sorted.length > visible.length
        ? "显示 " + visible.length + " / " + sorted.length + " 项"
        : children.length ? "共 " + children.length + " 项" : ""
    );

    renderEntries(visible, false, null);
    renderMore(sorted.length, visible.length, false);

    if (!children.length) {
      if (dom.content) {
        dom.content.hidden = false;
        clear(dom.content);
        dom.content.appendChild(emptyState(
          "folder",
          isRoot() ? "这里还没有文件" : "这个文件夹还是空的",
          isRoot()
            ? "打开可视化编辑器，导入或新建一份目录数据，再导出覆盖 pan/data.json。"
            : "回到上一级看看，或者在编辑器中给这个文件夹添加内容。",
          { label: "回到全部文件", href: "#/" }
        ));
      }
    }
  }

  function renderSearchResults() {
    var results = PanData.searchTree(state.data.tree, state.query, SEARCH_LIMIT);
    var byId = Object.create(null);
    results.forEach(function (result) {
      byId[result.node.id] = result;
    });
    var sorted = PanData.sortNodes(results.map(function (result) {
      return result.node;
    }), state.sort, state.direction).map(function (node) {
      return byId[node.id];
    }).filter(Boolean);

    if (dom.currentTitle) dom.currentTitle.textContent = "搜索结果";
    if (dom.currentSub) dom.currentSub.textContent = "关键词：“" + state.query + "”";
    if (dom.count) {
      dom.count.hidden = false;
      dom.count.textContent = results.length + " 个结果";
    }
    setStatus(
      results.length >= SEARCH_LIMIT
        ? "结果较多，只显示前 " + SEARCH_LIMIT + " 个，请换一个更具体的关键词。"
        : "找到 " + results.length + " 个结果"
    );

    var visible = sorted.slice(0, state.limit);
    renderEntries(visible.map(function (result) { return result.node; }), true, null);
    renderMore(sorted.length, visible.length, true);

    if (!results.length) {
      if (dom.content) {
        dom.content.hidden = false;
        clear(dom.content);
        dom.content.appendChild(emptyState(
          "search",
          "没有找到“" + state.query + "”",
          "试试更短的关键词，或者直接翻一翻左边的目录。",
          { label: "清空搜索", onClick: clearSearch }
        ));
      }
    }
  }

  function renderEntries(nodes, isSearch, parentPath) {
    if (!dom.content) return;
    dom.content.hidden = false;
    clear(dom.content);
    var list = el("div", "pan-entries" + (state.view === "grid" ? " is-grid" : ""));
    var fragment = document.createDocumentFragment();
    nodes.forEach(function (node) {
      var result = isSearch ? state.index[node.id] : null;
      fragment.appendChild(createEntry(node, isSearch ? result : null));
    });
    list.appendChild(fragment);
    dom.content.appendChild(list);
  }

  function createEntry(node, result) {
    var article = el("article", "pan-entry");
    article.setAttribute("data-id", node.id);

    var iconWrap = el("span", "pan-entry-icon" + (node.type === "file" ? " is-file" : ""));
    iconWrap.appendChild(icon(node.type === "folder" ? "i-folder" : "i-file"));
    article.appendChild(iconWrap);

    var copy = el("div", "pan-entry-copy");
    var nameNode;
    if (node.type === "folder") {
      nameNode = el("a", "pan-entry-name", node.name);
      nameNode.href = "#/folder/" + encodeURIComponent(node.id);
      nameNode.addEventListener("click", function () {
        closeSidebar(false);
        clearSearchState();
      });
    } else {
      nameNode = el("button", "pan-entry-name", node.name);
      nameNode.type = "button";
      nameNode.addEventListener("click", function () {
        openFileDialog(node);
      });
    }
    nameNode.title = node.name;
    copy.appendChild(nameNode);

    if (node.description) {
      var desc = el("p", "pan-entry-desc", node.description);
      desc.title = node.description;
      copy.appendChild(desc);
    }

    if (result) {
      var pathLine = el("p", "pan-entry-path");
      pathLine.appendChild(icon("i-folder"));
      pathLine.appendChild(document.createTextNode(pathLabel(result.path.slice(0, -1), true)));
      copy.appendChild(pathLine);
    }

    article.appendChild(copy);

    var meta = el("div", "pan-entry-meta");
    if (node.type === "folder") {
      meta.appendChild(el("span", null, (node.children ? node.children.length : 0) + " 项"));
    } else {
      meta.appendChild(el("span", "is-size", PanData.formatSize(node.size)));
      meta.appendChild(el("span", null, PanData.formatDate(node.updatedAt)));
    }
    article.appendChild(meta);

    var actions = el("div", "pan-entry-actions");
    if (node.type === "folder") {
      var openLink = el("a", "btn btn-soft btn-sm");
      openLink.href = "#/folder/" + encodeURIComponent(node.id);
      openLink.appendChild(document.createTextNode("打开"));
      openLink.appendChild(icon("i-arrow"));
      actions.appendChild(openLink);
    } else {
      var check = PanData.checkExternalUrl(node.url, dataOptions());
      var download = el("a", "btn btn-primary btn-sm");
      download.appendChild(icon("i-external"));
      download.appendChild(document.createTextNode("下载"));
      download.target = "_blank";
      download.rel = "noopener noreferrer";
      download.referrerPolicy = "no-referrer";
      download.setAttribute("aria-label", "在新窗口下载 " + node.name);
      if (check.ok) {
        download.href = check.url;
      } else {
        download.href = "#";
        download.classList.add("is-disabled");
        download.setAttribute("aria-disabled", "true");
        download.title = check.reason;
        download.addEventListener("click", function (event) {
          event.preventDefault();
        });
      }
      actions.appendChild(download);

      var details = el("button", "btn btn-ghost btn-sm");
      details.type = "button";
      details.appendChild(icon("i-info"));
      details.appendChild(document.createTextNode("详情"));
      details.addEventListener("click", function () {
        openFileDialog(node);
      });
      actions.appendChild(details);
    }
    article.appendChild(actions);

    return article;
  }

  function renderMore(total, shown, isSearch) {
    if (!dom.more || !dom.moreBtn) return;
    if (shown < total) {
      dom.more.hidden = false;
      dom.moreBtn.hidden = false;
      dom.moreBtn.textContent = "加载更多（还有 " + (total - shown) + " 项）";
      if (dom.moreNote) {
        dom.moreNote.textContent = isSearch
          ? "搜索最多显示 " + SEARCH_LIMIT + " 个结果。"
          : "每次加载 " + PAGE_SIZE + " 项，保持页面轻快。";
      }
    } else {
      dom.more.hidden = true;
    }
  }

  function emptyState(kind, title, message, action) {
    var wrap = el("div", "pan-empty");
    var iconWrap = el("span", "pan-empty-icon");
    iconWrap.appendChild(icon(kind === "search" ? "i-search" : "i-folder-open"));
    wrap.appendChild(iconWrap);
    wrap.appendChild(el("strong", null, title));
    wrap.appendChild(el("p", null, message));
    if (action) {
      var control;
      if (action.href) {
        control = el("a", "btn btn-ghost btn-sm", action.label);
        control.href = action.href;
      } else {
        control = el("button", "btn btn-ghost btn-sm", action.label);
        control.type = "button";
        if (action.onClick) control.addEventListener("click", action.onClick);
      }
      wrap.appendChild(control);
    }
    return wrap;
  }

  function pathLabel(path, includeRoot) {
    var names = [];
    if (includeRoot) names.push("全部文件");
    (path || []).forEach(function (node) {
      if (node && node.name) names.push(node.name);
    });
    return names.join(" / ");
  }

  function renderBreadcrumb() {
    if (!dom.breadcrumb) return;
    clear(dom.breadcrumb);
    var rootLink = el("a", "pan-crumb", "全部文件");
    rootLink.href = "#/";
    if (isRoot()) {
      rootLink.className = "pan-crumb is-current";
    }
    dom.breadcrumb.appendChild(rootLink);

    if (!isRoot()) {
      var entry = state.index[state.routeId];
      if (entry && entry.path) {
        entry.path.forEach(function (node, index) {
          dom.breadcrumb.appendChild(el("span", "pan-crumb-sep", "/"));
          var isLast = index === entry.path.length - 1;
          if (isLast) {
            dom.breadcrumb.appendChild(el("span", "pan-crumb is-current", node.name));
          } else {
            var link = el("a", "pan-crumb", node.name);
            link.href = "#/folder/" + encodeURIComponent(node.id);
            dom.breadcrumb.appendChild(link);
          }
        });
      }
    }
  }

  function renderTree() {
    if (!dom.tree || !state.data) return;
    clear(dom.tree);
    if (dom.tree.parentElement) dom.tree.parentElement.classList.remove("is-loading");

    var rootRow = el("div", "pan-tree-row");
    var rootSpacer = el("span", "pan-tree-caret is-empty");
    rootSpacer.setAttribute("aria-hidden", "true");
    rootRow.appendChild(rootSpacer);
    var rootLink = el("a", "pan-tree-link is-root" + (isRoot() ? " is-current" : ""));
    rootLink.href = "#/";
    rootLink.appendChild(icon("i-home"));
    rootLink.appendChild(el("span", null, "全部文件"));
    if (state.stats) {
      rootLink.appendChild(el("span", "pan-tree-count", String(state.stats.nodes)));
    }
    if (isRoot()) rootLink.setAttribute("aria-current", "page");
    rootRow.appendChild(rootLink);
    dom.tree.appendChild(rootRow);

    appendTreeFolders(state.data.tree, dom.tree);
  }

  function appendTreeFolders(children, container) {
    var folders = children.filter(function (node) {
      return node && node.type === "folder";
    });
    if (!folders.length) return;

    var group = el("div", "pan-tree-children" + (container === dom.tree ? " is-root-level" : ""));
    folders.forEach(function (folder) {
      var hasFolders = folder.children && folder.children.some(function (node) {
        return node.type === "folder";
      });
      var row = el("div", "pan-tree-row");
      var caret;
      if (hasFolders) {
        caret = el("button", "pan-tree-caret");
        caret.type = "button";
        caret.setAttribute("aria-expanded", state.expanded[folder.id] ? "true" : "false");
        caret.setAttribute("aria-label", (state.expanded[folder.id] ? "收起" : "展开") + " " + folder.name);
        caret.appendChild(icon("i-chevron"));
        caret.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (state.expanded[folder.id]) delete state.expanded[folder.id];
          else state.expanded[folder.id] = true;
          renderTree();
        });
      } else {
        caret = el("span", "pan-tree-caret is-empty");
        caret.setAttribute("aria-hidden", "true");
      }
      row.appendChild(caret);

      var link = el("a", "pan-tree-link");
      link.href = "#/folder/" + encodeURIComponent(folder.id);
      if (state.routeId === folder.id) {
        link.className += " is-current";
        link.setAttribute("aria-current", "page");
      }
      link.appendChild(icon(state.routeId === folder.id ? "i-folder-open" : "i-folder"));
      link.appendChild(el("span", null, folder.name));
      link.appendChild(el("span", "pan-tree-count", String(folder.children ? folder.children.length : 0)));
      link.title = folder.name;
      row.appendChild(link);
      group.appendChild(row);

      if (hasFolders && state.expanded[folder.id]) {
        appendTreeFolders(folder.children, group);
      }
    });
    container.appendChild(group);
  }

  function openFileDialog(node) {
    if (!dom.dialog || node.type !== "file") return;
    var path = state.index[node.id] ? pathLabel(state.index[node.id].path, true) : pathLabel([], true);
    var check = PanData.checkExternalUrl(node.url, dataOptions());
    var code = typeof node.code === "string" ? node.code.trim() : "";
    var description = typeof node.description === "string" ? node.description.trim() : "";

    state.dialogNode = node;
    if (dom.dialogType) dom.dialogType.textContent = "文件详情";
    if (dom.dialogTitle) dom.dialogTitle.textContent = node.name;
    if (dom.dialogPath) dom.dialogPath.textContent = path;
    if (dom.dialogDesc) {
      dom.dialogDesc.hidden = !description;
      dom.dialogDesc.textContent = description;
    }
    if (dom.dialogSize) dom.dialogSize.textContent = PanData.formatSize(node.size);
    if (dom.dialogDate) dom.dialogDate.textContent = PanData.formatDate(node.updatedAt);
    if (dom.dialogKind) dom.dialogKind.textContent = fileKind(node.name);
    if (dom.dialogIcon) {
      clear(dom.dialogIcon);
      dom.dialogIcon.appendChild(icon("i-file"));
    }

    if (dom.dialogCode) {
      dom.dialogCode.hidden = !code;
      if (dom.dialogCodeValue) dom.dialogCodeValue.textContent = code;
    }
    if (dom.dialogUrl) dom.dialogUrl.textContent = check.ok ? check.url : "链接无效：" + check.reason;
    if (dom.dialogDownload) {
      if (check.ok) {
        dom.dialogDownload.href = check.url;
        dom.dialogDownload.removeAttribute("aria-disabled");
        dom.dialogDownload.classList.remove("is-disabled");
        dom.dialogDownload.classList.add("btn-primary");
      } else {
        dom.dialogDownload.href = "#";
        dom.dialogDownload.setAttribute("aria-disabled", "true");
        dom.dialogDownload.classList.add("is-disabled");
      }
    }

    if (typeof dom.dialog.showModal === "function") {
      if (!dom.dialog.open) dom.dialog.showModal();
    } else {
      dom.dialog.setAttribute("open", "open");
    }
  }

  function fileKind(name) {
    var dot = String(name || "").lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
      return name.slice(dot + 1).toUpperCase() + " 文件";
    }
    return "文件";
  }

  function clearSearchState() {
    state.query = "";
    if (dom.search) dom.search.value = "";
    window.clearTimeout(state.searchTimer);
  }

  function clearSearch() {
    clearSearchState();
    renderCurrent();
    if (dom.search) dom.search.focus();
  }

  function openSidebar() {
    document.body.classList.add("pan-side-open");
    if (dom.treeToggle) dom.treeToggle.setAttribute("aria-expanded", "true");
    if (dom.side) dom.side.inert = false;
    if (dom.sideClose) dom.sideClose.focus();
  }

  function closeSidebar(returnFocus) {
    document.body.classList.remove("pan-side-open");
    if (dom.treeToggle) dom.treeToggle.setAttribute("aria-expanded", "false");
    updateSidebarInert();
    if (returnFocus && dom.treeToggle) dom.treeToggle.focus();
  }

  function updateSidebarInert() {
    if (!dom.side) return;
    var mobile = window.matchMedia("(max-width: 900px)").matches;
    var open = document.body.classList.contains("pan-side-open");
    if (mobile && !open) dom.side.setAttribute("inert", "");
    else dom.side.removeAttribute("inert");
  }

  function handleHashChange() {
    routeFromHash(false);
  }

  function bindEvents() {
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("resize", updateSidebarInert);

    if (dom.search) {
      dom.search.addEventListener("input", function () {
        window.clearTimeout(state.searchTimer);
        var value = dom.search.value.trim();
        state.searchTimer = window.setTimeout(function () {
          state.query = value;
          state.limit = PAGE_SIZE;
          renderCurrent();
        }, 130);
      });
      dom.search.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          clearSearchState();
          renderCurrent();
          dom.search.blur();
        }
      });
    }

    if (dom.sort) {
      dom.sort.addEventListener("change", function () {
        state.sort = dom.sort.value;
        writePref(SORT_KEY, state.sort);
        state.limit = PAGE_SIZE;
        renderCurrent();
      });
    }

    if (dom.sortDir) {
      dom.sortDir.addEventListener("click", function () {
        state.direction = state.direction === "desc" ? "asc" : "desc";
        writePref(DIR_KEY, state.direction);
        updateSortDirection();
        state.limit = PAGE_SIZE;
        renderCurrent();
      });
    }

    if (dom.view) {
      dom.view.addEventListener("click", function () {
        state.view = state.view === "grid" ? "list" : "grid";
        writePref(VIEW_KEY, state.view);
        updateViewButton();
      });
    }

    if (dom.moreBtn) {
      dom.moreBtn.addEventListener("click", function () {
        state.limit += PAGE_SIZE;
        renderCurrent();
      });
    }

    if (dom.treeToggle) {
      dom.treeToggle.addEventListener("click", function () {
        if (document.body.classList.contains("pan-side-open")) closeSidebar(true);
        else openSidebar();
      });
    }
    if (dom.sideClose) dom.sideClose.addEventListener("click", function () { closeSidebar(true); });
    if (dom.sideBackdrop) dom.sideBackdrop.addEventListener("click", function () { closeSidebar(true); });

    if (dom.breadcrumb) {
      dom.breadcrumb.addEventListener("click", function (event) {
        var link = event.target.closest("a");
        if (!link) return;
        clearSearchState();
        if (link.getAttribute("href") === (window.location.hash || "#/")) renderCurrent();
      });
    }

    if (dom.tree) {
      dom.tree.addEventListener("click", function (event) {
        var link = event.target.closest("a");
        if (!link) return;
        clearSearchState();
        closeSidebar(false);
        if (link.getAttribute("href") === (window.location.hash || "#/")) renderCurrent();
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && document.body.classList.contains("pan-side-open")) {
        closeSidebar(true);
      }
    });

    if (dom.dialogCopy) {
      dom.dialogCopy.addEventListener("click", function () {
        var node = state.dialogNode;
        var code = node && typeof node.code === "string" ? node.code.trim() : "";
        if (!code) return;
        copyText(code, "提取码已复制");
      });
    }

    if (dom.dialog) {
      dom.dialog.addEventListener("click", function (event) {
        if (event.target === dom.dialog) {
          dom.dialog.close();
        }
      });
      dom.dialog.addEventListener("close", function () {
        state.dialogNode = null;
      });
    }
  }

  function copyText(text, successMessage) {
    function fail() {
      if (window.LeoUI && window.LeoUI.toast) {
        window.LeoUI.toast("复制失败，请手动选择提取码", { type: "warn" });
      }
    }

    if (window.LeoUI && typeof window.LeoUI.copyText === "function") {
      window.LeoUI.copyText(text).then(function () {
        if (window.LeoUI.toast) window.LeoUI.toast(successMessage, { type: "success" });
      }).catch(fail);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (window.LeoUI && window.LeoUI.toast) window.LeoUI.toast(successMessage, { type: "success" });
      }).catch(fail);
      return;
    }
    fail();
  }

  function init() {
    cacheDom();
    restorePreferences();
    bindEvents();
    updateSidebarInert();
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
