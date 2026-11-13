/* ============================================================
   pan-editor.js — 网盘目录可视化编辑器
   同时服务 /pan/edit/ 在线版与 tools/local-editor.html 本地版。
   ============================================================ */

(function () {
  "use strict";

  var PanData = window.PanData;
  if (!PanData) {
    return;
  }

  var config = window.PAN_EDITOR_CONFIG || {};
  var isLocal = config.mode === "local";
  var DRAFT_KEY = config.draftKey || (isLocal ? "leoljs.pan.local.draft.v1" : "leoljs.pan.draft.v1");
  var PAGE_SIZE = 50;
  var MAX_SNAPSHOTS = 50;

  var state = {
    data: null,
    currentId: null,
    expanded: Object.create(null),
    page: 1,
    filterMissing: false,
    tab: "folder",
    fileId: null,
    snapshots: [],
    snapIndex: -1,
    dirty: false,
    jsonDirty: false,
    draftDisabled: false,
    draftTimer: 0,
    scanResult: null,
    scanning: false,
    cancelScan: false
  };

  var dom = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function toast(message, type) {
    if (window.LeoUI && typeof window.LeoUI.toast === "function") {
      window.LeoUI.toast(message, { type: type || "success", duration: 3600 });
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dataOptions() {
    var options = { origin: window.location.origin };
    var hosts = ["leo-ljs.github.io", "www.leo-ljs.github.io"];
    if (window.location.hostname && hosts.indexOf(window.location.hostname) === -1) {
      hosts.push(window.location.hostname);
    }
    options.siteHosts = hosts;
    return options;
  }

  function cacheDom() {
    dom.scanOpen = byId("scan-open");
    dom.importOpen = byId("import-open");
    dom.exportBtn = byId("export-btn");
    dom.draftBanner = byId("draft-banner");
    dom.draftTitle = byId("draft-title");
    dom.draftText = byId("draft-text");
    dom.draftUseOnline = byId("draft-use-online");
    dom.draftClear = byId("draft-clear");
    dom.alertBox = byId("alert-box");
    dom.alertTitle = byId("alert-title");
    dom.alertList = byId("alert-list");
    dom.alertClose = byId("alert-close");
    dom.editTree = byId("edit-tree");
    dom.editStats = byId("edit-stats");
    dom.addFolder = byId("add-folder");
    dom.addFile = byId("add-file");
    dom.tabFolder = byId("tab-folder");
    dom.tabJson = byId("tab-json");
    dom.folderView = byId("folder-view");
    dom.jsonView = byId("json-view");
    dom.undoBtn = byId("undo-btn");
    dom.redoBtn = byId("redo-btn");
    dom.editBreadcrumb = byId("edit-breadcrumb");
    dom.folderSummary = byId("folder-summary");
    dom.rootInfo = byId("root-info");
    dom.rootForm = byId("root-form");
    dom.rootTitle = byId("root-title");
    dom.rootNotice = byId("root-notice");
    dom.folderInfo = byId("folder-info");
    dom.folderHeading = byId("folder-heading");
    dom.folderForm = byId("folder-form");
    dom.folderName = byId("folder-name");
    dom.folderDesc = byId("folder-desc");
    dom.folderDelete = byId("folder-delete");
    dom.childCount = byId("child-count");
    dom.missingOnly = byId("missing-only");
    dom.addFile2 = byId("add-file-2");
    dom.childList = byId("child-list");
    dom.childEmpty = byId("child-empty");
    dom.tableWrap = document.querySelector("#folder-view .table-wrap");
    dom.prevPage = byId("prev-page");
    dom.nextPage = byId("next-page");
    dom.pageLabel = byId("page-label");
    dom.jsonText = byId("json-text");
    dom.jsonApply = byId("json-apply");
    dom.jsonRefresh = byId("json-refresh");
    dom.jsonErrors = byId("json-errors");
    dom.importInput = byId("import-input");
    dom.fileDialog = byId("file-dialog");
    dom.fileForm = byId("file-form");
    dom.fileDialogTitle = byId("file-dialog-title");
    dom.fileClose = byId("file-close");
    dom.fileName = byId("file-name");
    dom.fileUrl = byId("file-url");
    dom.fileUrlStatus = byId("file-url-status");
    dom.fileCode = byId("file-code");
    dom.fileSize = byId("file-size");
    dom.fileDate = byId("file-date");
    dom.fileDesc = byId("file-desc");
    dom.fileDelete = byId("file-delete");
    dom.fileCancel = byId("file-cancel");
    dom.scanDialog = byId("scan-dialog");
    dom.scanClose = byId("scan-close");
    dom.scanDrop = byId("scan-drop");
    dom.scanPickDir = byId("scan-pick-dir");
    dom.scanPickFiles = byId("scan-pick-files");
    dom.scanDirInput = byId("scan-dir-input");
    dom.scanFilesInput = byId("scan-files-input");
    dom.scanProgress = byId("scan-progress");
    dom.scanProgressBar = byId("scan-progress-bar");
    dom.scanProgressText = byId("scan-progress-text");
    dom.scanCancel = byId("scan-cancel");
    dom.scanPreview = byId("scan-preview");
    dom.scanName = byId("scan-name");
    dom.scanSummary = byId("scan-summary");
    dom.scanNotes = byId("scan-notes");
    dom.scanApply = byId("scan-apply");
    dom.scanDismiss = byId("scan-dismiss");
  }

  /* ---------------- 数据与持久化 ---------------- */

  function emptyData() {
    return PanData.createEmptyData({ title: "我的网盘" });
  }

  function getDraft() {
    if (state.draftDisabled) return null;
    var raw = null;
    try {
      raw = window.localStorage.getItem(DRAFT_KEY);
    } catch (error) {
      state.draftDisabled = true;
      return null;
    }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 1 || parsed.type !== "leoljs-pan" || !Array.isArray(parsed.tree)) {
        return null;
      }
      var clean = PanData.sanitizeData(parsed);
      if (!clean || typeof clean !== "object") return null;
      if (typeof clean.title !== "string") clean.title = "我的网盘";
      if (typeof clean.notice !== "string") clean.notice = "";
      if (typeof clean.updatedAt !== "string") clean.updatedAt = PanData.todayLocal();
      clean.tree = Array.isArray(clean.tree) ? clean.tree : [];
      return clean;
    } catch (error) {
      return null;
    }
  }

  function saveDraftNow() {
    if (!state.data || state.draftDisabled) return;
    window.clearTimeout(state.draftTimer);
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state.data));
    } catch (error) {
      state.draftDisabled = true;
      showAlert("无法自动保存草稿", [
        "浏览器拒绝写入 localStorage，可能是隐私模式或空间不足。",
        "请及时点击“导出 data.json”，避免丢失修改。"
      ]);
    }
  }

  function scheduleDraft() {
    window.clearTimeout(state.draftTimer);
    state.draftTimer = window.setTimeout(saveDraftNow, 350);
  }

  function removeDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      // 忽略存储不可用。
    }
  }

  function markDirty() {
    state.dirty = true;
    scheduleDraft();
  }

  function resetHistory() {
    state.snapshots = [JSON.stringify(state.data)];
    state.snapIndex = 0;
    updateHistoryButtons();
  }

  function pushSnapshot() {
    var snapshot = JSON.stringify(state.data);
    if (state.snapIndex >= 0 && state.snapshots[state.snapIndex] === snapshot) return;
    if (state.snapIndex < state.snapshots.length - 1) {
      state.snapshots = state.snapshots.slice(0, state.snapIndex + 1);
    }
    state.snapshots.push(snapshot);
    if (state.snapshots.length > MAX_SNAPSHOTS) {
      state.snapshots.shift();
    }
    state.snapIndex = state.snapshots.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (!dom.undoBtn || !dom.redoBtn) return;
    dom.undoBtn.disabled = state.snapIndex <= 0;
    dom.redoBtn.disabled = state.snapIndex < 0 || state.snapIndex >= state.snapshots.length - 1;
  }

  function restoreSnapshot(index) {
    if (index < 0 || index >= state.snapshots.length) return;
    state.snapIndex = index;
    state.data = JSON.parse(state.snapshots[index]);
    ensureCurrent();
    state.page = 1;
    state.dirty = true;
    saveDraftNow();
    renderAll();
  }

  function undo() {
    if (state.snapIndex <= 0) return;
    restoreSnapshot(state.snapIndex - 1);
  }

  function redo() {
    if (state.snapIndex >= state.snapshots.length - 1) return;
    restoreSnapshot(state.snapIndex + 1);
  }

  function commit() {
    pushSnapshot();
    state.dirty = true;
    saveDraftNow();
    renderAll();
  }

  /* ---------------- 目录查询 ---------------- */

  function ensureCurrent() {
    if (!state.currentId || !state.data) return;
    var found = PanData.findNode(state.data.tree, state.currentId);
    if (!found || !found.node || found.node.type !== "folder") {
      state.currentId = null;
    }
  }

  function getCurrentFolder() {
    if (!state.data) return null;
    ensureCurrent();
    if (!state.currentId) return null;
    var found = PanData.findNode(state.data.tree, state.currentId);
    return found && found.node.type === "folder" ? found.node : null;
  }

  function getChildren() {
    if (!state.data) return [];
    var folder = getCurrentFolder();
    if (folder) return folder.children;
    return state.data.tree;
  }

  function selectFolder(id) {
    state.currentId = id || null;
    state.page = 1;
    if (id) {
      expandPath(id);
      state.expanded[id] = true;
    }
    renderAll();
  }

  function expandPath(id) {
    if (!state.data || !id) return;
    var found = PanData.findNode(state.data.tree, id);
    if (!found) return;
    found.path.forEach(function (node) {
      if (node && node.type === "folder") state.expanded[node.id] = true;
    });
  }

  function isMissingUrl(node) {
    return node && node.type === "file" && !PanData.checkExternalUrl(node.url, dataOptions()).ok;
  }

  function removeNodeById(id) {
    var found = PanData.findNode(state.data.tree, id);
    if (!found) return false;
    if (found.parent) found.parent.children.splice(found.index, 1);
    else state.data.tree.splice(found.index, 1);
    return true;
  }

  function setCurrentChildren(children) {
    if (!state.data) return;
    var folder = getCurrentFolder();
    if (folder) folder.children = children;
    else state.data.tree = children;
  }

  /* ---------------- 通用渲染 ---------------- */

  function renderAll() {
    if (!state.data) return;
    ensureCurrent();
    renderStats();
    renderTree();
    renderFolderView();
    if (state.tab === "json" && !state.jsonDirty) renderJson();
    updateHistoryButtons();
  }

  function renderStats() {
    if (!dom.editStats) return;
    var stats = PanData.collectStats(state.data);
    clear(dom.editStats);
    dom.editStats.appendChild(document.createTextNode("共 "));
    dom.editStats.appendChild(el("strong", null, stats.nodes + " 个节点"));
    dom.editStats.appendChild(document.createTextNode(
      " · " + stats.folders + " 个文件夹 · " + stats.files + " 个文件"
    ));
    var line = el("div", null);
    var size = el("span", stats.bytes > PanData.LIMITS.maxBytes ? "is-over" : null, PanData.formatSize(stats.bytes));
    line.appendChild(size);
    line.appendChild(document.createTextNode(" / 10 MB"));
    dom.editStats.appendChild(line);
    if (stats.nodes > PanData.LIMITS.maxNodes) {
      dom.editStats.appendChild(el("div", "is-over", "节点数超过 " + PanData.LIMITS.maxNodes + "，请精简目录。"));
    }
  }

  function renderTree() {
    if (!dom.editTree) return;
    clear(dom.editTree);

    var rootRow = el("div", "edit-tree-row edit-tree-root" + (state.currentId ? "" : " is-current"));
    rootRow.appendChild(el("span", "edit-tree-spacer"));
    var rootLink = el("button", "edit-tree-link");
    rootLink.type = "button";
    rootLink.setAttribute("role", "treeitem");
    if (!state.currentId) rootLink.setAttribute("aria-current", "true");
    rootLink.appendChild(icon("folder-open"));
    rootLink.appendChild(el("span", null, "全部文件"));
    rootLink.appendChild(el("span", "edit-tree-count", String(state.data.tree.length)));
    rootLink.addEventListener("click", function () {
      selectFolder(null);
    });
    rootRow.appendChild(rootLink);
    dom.editTree.appendChild(rootRow);

    appendFolderRows(state.data.tree, 0, dom.editTree);
  }

  function appendFolderRows(nodes, depth, container) {
    var folders = (Array.isArray(nodes) ? nodes : []).filter(function (node) {
      return node && node.type === "folder" && Array.isArray(node.children);
    });
    folders.forEach(function (folder) {
      var row = el("div", "edit-tree-row" + (folder.id === state.currentId ? " is-current" : ""));
      row.style.paddingLeft = 10 + depth * 14 + "px";

      if (folder.children.length) {
        var toggle = el("button", "edit-tree-toggle");
        toggle.type = "button";
        toggle.setAttribute("aria-label", (state.expanded[folder.id] ? "折叠 " : "展开 ") + folder.name);
        toggle.setAttribute("aria-expanded", state.expanded[folder.id] ? "true" : "false");
        toggle.appendChild(icon("chevron"));
        toggle.addEventListener("click", function (event) {
          event.stopPropagation();
          state.expanded[folder.id] = !state.expanded[folder.id];
          renderTree();
        });
        row.appendChild(toggle);
      } else {
        row.appendChild(el("span", "edit-tree-spacer"));
      }

      var link = el("button", "edit-tree-link");
      link.type = "button";
      link.setAttribute("role", "treeitem");
      if (folder.id === state.currentId) link.setAttribute("aria-current", "true");
      link.appendChild(icon(state.expanded[folder.id] ? "folder-open" : "folder"));
      link.appendChild(el("span", null, folder.name || "未命名文件夹"));
      link.appendChild(el("span", "edit-tree-count", String(folder.children.length)));
      link.title = folder.description || folder.name || "";
      link.addEventListener("click", function () {
        selectFolder(folder.id);
      });
      row.appendChild(link);
      container.appendChild(row);

      if (state.expanded[folder.id]) {
        appendFolderRows(folder.children, depth + 1, container);
      }
    });
  }

  function renderBreadcrumb() {
    clear(dom.editBreadcrumb);
    var rootButton = el("button", null, "全部文件");
    rootButton.type = "button";
    if (!state.currentId) {
      rootButton.className = "crumb-current";
      rootButton.setAttribute("aria-current", "page");
    } else {
      rootButton.addEventListener("click", function () {
        selectFolder(null);
      });
    }
    dom.editBreadcrumb.appendChild(rootButton);

    if (!state.currentId) return;
    var found = PanData.findNode(state.data.tree, state.currentId);
    if (!found) return;
    found.path.forEach(function (node, index) {
      dom.editBreadcrumb.appendChild(el("span", "crumb-sep", "/"));
      var isLast = index === found.path.length - 1;
      if (isLast) {
        dom.editBreadcrumb.appendChild(el("span", "crumb-current", node.name || "未命名文件夹"));
      } else if (node.type === "folder") {
        var button = el("button", null, node.name || "未命名文件夹");
        button.type = "button";
        button.addEventListener("click", function () {
          selectFolder(node.id);
        });
        dom.editBreadcrumb.appendChild(button);
      }
    });
  }

  function renderFolderView() {
    if (!state.data) return;
    var folder = getCurrentFolder();
    var isRoot = !folder;

    show(dom.rootInfo, isRoot);
    show(dom.folderInfo, !isRoot);

    if (isRoot) {
      dom.rootTitle.value = state.data.title || "";
      dom.rootNotice.value = state.data.notice || "";
      dom.folderSummary.textContent = "整棵目录的根部；在这里管理所有顶层文件夹和文件。";
    } else {
      dom.folderHeading.textContent = "文件夹信息";
      dom.folderName.value = folder.name || "";
      dom.folderDesc.value = folder.description || "";
      var count = folder.children.length;
      dom.folderSummary.textContent = count + " 个直接子项" + (folder.description ? " · " + folder.description : "");
    }

    renderBreadcrumb();
    renderTable();
  }

  function renderTable() {
    if (!dom.childList) return;
    var children = getChildren().filter(function (node) {
      return node && (node.type === "folder" || node.type === "file") && typeof node.name === "string";
    });
    var visible = children.slice();
    if (state.filterMissing) visible = visible.filter(isMissingUrl);

    var pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    var start = (state.page - 1) * PAGE_SIZE;
    var slice = visible.slice(start, start + PAGE_SIZE);

    clear(dom.childList);
    slice.forEach(function (node) {
      dom.childList.appendChild(buildTableRow(node));
    });

    var isEmpty = visible.length === 0;
    show(dom.tableWrap, !isEmpty);
    show(dom.childEmpty, isEmpty);
    dom.childEmpty.textContent = state.filterMissing
      ? "没有缺失外链的文件，很好。"
      : "这个文件夹还是空的，点右上角新增文件或文件夹。";
    dom.childCount.textContent = visible.length + " 项" + (state.filterMissing ? "（只看缺失外链）" : "");
    dom.pageLabel.textContent = "第 " + state.page + " / " + pages + " 页 · 共 " + visible.length + " 项";
    dom.prevPage.disabled = state.page <= 1;
    dom.nextPage.disabled = state.page >= pages;
    show(dom.prevPage, pages > 1);
    show(dom.nextPage, pages > 1);
    show(dom.pageLabel, pages > 1);
  }

  function buildTableRow(node) {
    var row = el("tr");
    var isFolder = node.type === "folder";

    var nameCell = el("td");
    var nameWrap = el("div", "name-cell" + (isFolder ? " folder" : ""));
    nameWrap.appendChild(icon(isFolder ? "folder" : "file"));
    var nameButton = el("button", "name-button", node.name);
    nameButton.type = "button";
    nameButton.title = isFolder ? "打开文件夹" : "编辑文件详情";
    nameButton.addEventListener("click", function () {
      if (isFolder) selectFolder(node.id);
      else openFileDialog(node.id);
    });
    nameWrap.appendChild(nameButton);
    nameWrap.appendChild(el("span", "type-tag", isFolder ? "文件夹" : "文件"));
    nameCell.appendChild(nameWrap);
    row.appendChild(nameCell);

    var urlCell = el("td");
    if (isFolder) {
      urlCell.textContent = "—";
    } else {
      var urlInput = el("input", "inline-input");
      urlInput.type = "url";
      urlInput.value = node.url || "";
      urlInput.placeholder = "https://…";
      urlInput.setAttribute("aria-label", "下载外链：" + node.name);
      urlInput.addEventListener("input", function () {
        var found = PanData.findNode(state.data.tree, node.id);
        if (!found) return;
        found.node.url = urlInput.value.trim();
        markDirty();
        updateInlineUrlState(urlInput, found.node.url);
      });
      urlInput.addEventListener("change", function () {
        var found = PanData.findNode(state.data.tree, node.id);
        if (!found) return;
        found.node.url = urlInput.value.trim();
        pushSnapshot();
        saveDraftNow();
        updateInlineUrlState(urlInput, found.node.url);
        if (state.filterMissing) renderTable();
        else renderStats();
      });
      updateInlineUrlState(urlInput, node.url);
      urlCell.appendChild(urlInput);
    }
    row.appendChild(urlCell);

    var codeCell = el("td");
    if (!isFolder) {
      var codeInput = el("input", "inline-input inline-code");
      codeInput.type = "text";
      codeInput.value = node.code || "";
      codeInput.placeholder = "可选";
      codeInput.maxLength = 32;
      codeInput.setAttribute("aria-label", "提取码：" + node.name);
      codeInput.addEventListener("input", function () {
        var found = PanData.findNode(state.data.tree, node.id);
        if (!found) return;
        found.node.code = codeInput.value;
        markDirty();
      });
      codeInput.addEventListener("change", function () {
        var found = PanData.findNode(state.data.tree, node.id);
        if (!found) return;
        found.node.code = codeInput.value;
        pushSnapshot();
        saveDraftNow();
      });
      codeCell.appendChild(codeInput);
    } else {
      codeCell.textContent = "—";
    }
    row.appendChild(codeCell);

    row.appendChild(el("td", "size-cell", !isFolder && node.size != null ? PanData.formatSize(node.size) : "—"));
    row.appendChild(el("td", "date-cell", !isFolder && node.updatedAt ? node.updatedAt : "—"));

    var actions = el("td", "col-actions");
    var wrap = el("div", "row-actions");

    var editButton = el("button", "icon-btn");
    editButton.type = "button";
    editButton.title = isFolder ? "打开" : "编辑";
    editButton.setAttribute("aria-label", (isFolder ? "打开 " : "编辑 ") + node.name);
    editButton.appendChild(icon(isFolder ? "folder-open" : "edit"));
    editButton.addEventListener("click", function () {
      if (isFolder) selectFolder(node.id);
      else openFileDialog(node.id);
    });
    wrap.appendChild(editButton);

    var deleteButton = el("button", "icon-btn");
    deleteButton.type = "button";
    deleteButton.title = "删除";
    deleteButton.setAttribute("aria-label", "删除 " + node.name);
    deleteButton.appendChild(icon("trash"));
    deleteButton.addEventListener("click", function () {
      deleteNode(node.id, node.name, isFolder);
    });
    wrap.appendChild(deleteButton);

    actions.appendChild(wrap);
    row.appendChild(actions);
    return row;
  }

  function updateInlineUrlState(input, value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) {
      input.classList.remove("is-error");
      input.title = "尚未填写外链";
      return;
    }
    var result = PanData.checkExternalUrl(trimmed, dataOptions());
    input.classList.toggle("is-error", !result.ok);
    input.title = result.ok ? "外链有效" : result.reason;
  }

  /* ---------------- 文件夹操作 ---------------- */

  function saveRoot(event) {
    event.preventDefault();
    var title = dom.rootTitle.value.trim();
    if (!title) {
      toast("标题不能为空", "warn");
      dom.rootTitle.focus();
      return;
    }
    state.data.title = title;
    state.data.notice = dom.rootNotice.value.trim();
    commit();
    toast("网盘信息已保存");
  }

  function saveFolder(event) {
    event.preventDefault();
    var folder = getCurrentFolder();
    if (!folder) return;
    var name = dom.folderName.value.trim();
    if (!name) {
      toast("文件夹名称不能为空", "warn");
      dom.folderName.focus();
      return;
    }
    var siblings = getChildren();
    var duplicate = siblings.some(function (node) {
      return node !== folder && node && node.name === name;
    });
    if (duplicate) {
      toast("同一层已经有同名文件夹或文件", "warn");
      dom.folderName.focus();
      return;
    }
    folder.name = name;
    folder.description = dom.folderDesc.value.trim();
    commit();
    toast("文件夹已保存");
  }

  function addFolder() {
    var parent = getChildren();
    var folder = PanData.createFolder(PanData.uniqueName(parent, "新建文件夹"));
    parent.push(folder);
    state.currentId = folder.id;
    state.expanded[folder.id] = true;
    state.page = 1;
    commit();
    toast("已新建文件夹");
    window.requestAnimationFrame(function () {
      if (dom.folderName) {
        dom.folderName.focus();
        dom.folderName.select();
      }
    });
  }

  function addFile() {
    var parent = getChildren();
    var file = PanData.createFile({ name: PanData.uniqueName(parent, "新建文件") });
    parent.push(file);
    state.page = 1;
    commit();
    openFileDialog(file.id);
  }

  function deleteNode(id, name, isFolder) {
    if (!id) return;
    var extra = "";
    if (isFolder) {
      var found = PanData.findNode(state.data.tree, id);
      if (found) {
        var count = PanData.collectStats({ tree: [found.node] });
        extra = "，里面的 " + Math.max(0, count.nodes - 1) + " 个节点也会一起删除";
      }
    }
    if (!window.confirm("确定删除“" + name + "”吗？" + extra + "。此操作可以撤销。")) return;

    var deletingCurrent = false;
    var parentId = null;
    var found = PanData.findNode(state.data.tree, id);
    if (found) {
      parentId = found.parent ? found.parent.id : null;
      deletingCurrent = found.path.some(function (node) {
        return node.id === state.currentId;
      });
    }

    if (!removeNodeById(id)) return;
    if (isFolder && deletingCurrent) state.currentId = parentId;
    ensureCurrent();
    state.page = 1;
    if (state.fileId === id) {
      closeDialog(dom.fileDialog);
      state.fileId = null;
    }
    commit();
    toast("已删除");
  }

  function deleteCurrentFolder() {
    var folder = getCurrentFolder();
    if (!folder) return;
    deleteNode(folder.id, folder.name, true);
  }

  /* ---------------- 文件弹窗 ---------------- */

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function openFileDialog(id) {
    var found = PanData.findNode(state.data.tree, id);
    if (!found || found.node.type !== "file") return;
    var node = found.node;
    state.fileId = id;
    dom.fileDialogTitle.textContent = "编辑文件";
    dom.fileName.value = node.name || "";
    dom.fileUrl.value = node.url || "";
    dom.fileCode.value = node.code || "";
    dom.fileSize.value = node.size == null ? "" : node.size;
    dom.fileDate.value = node.updatedAt || PanData.todayLocal();
    dom.fileDesc.value = node.description || "";
    updateFileUrlStatus();
    openDialog(dom.fileDialog);
    window.requestAnimationFrame(function () {
      dom.fileName.focus();
    });
  }

  function updateFileUrlStatus() {
    var raw = dom.fileUrl.value.trim();
    dom.fileUrl.classList.remove("is-error", "is-ok");
    dom.fileUrlStatus.classList.remove("is-error", "is-ok");
    if (!raw) {
      dom.fileUrlStatus.textContent = "还没有填写外链。可以先保存草稿，但导出前必须补上。";
      return;
    }
    var result = PanData.checkExternalUrl(raw, dataOptions());
    if (result.ok) {
      dom.fileUrl.classList.add("is-ok");
      dom.fileUrlStatus.classList.add("is-ok");
      dom.fileUrlStatus.textContent = "外链有效，查看页会通过新窗口打开它。";
    } else {
      dom.fileUrl.classList.add("is-error");
      dom.fileUrlStatus.classList.add("is-error");
      dom.fileUrlStatus.textContent = result.reason;
    }
  }

  function saveFile(event) {
    event.preventDefault();
    var found = PanData.findNode(state.data.tree, state.fileId);
    if (!found || found.node.type !== "file") {
      closeDialog(dom.fileDialog);
      return;
    }
    var node = found.node;

    var name = dom.fileName.value.trim();
    if (!name) {
      toast("文件名不能为空", "warn");
      dom.fileName.focus();
      return;
    }

    var url = dom.fileUrl.value.trim();
    if (url) {
      var check = PanData.checkExternalUrl(url, dataOptions());
      if (!check.ok) {
        updateFileUrlStatus();
        toast(check.reason, "error");
        dom.fileUrl.focus();
        return;
      }
    }

    var size = null;
    if (dom.fileSize.value.trim()) {
      size = Number(dom.fileSize.value);
      if (!Number.isFinite(size) || size < 0) {
        toast("大小需要填写非负数字，单位是字节", "warn");
        dom.fileSize.focus();
        return;
      }
    }

    var date = dom.fileDate.value.trim() || PanData.todayLocal();
    if (!PanData.isValidDateString(date)) {
      toast("日期格式不正确，请用 2026-11-13 这样的格式", "warn");
      dom.fileDate.focus();
      return;
    }

    node.name = name;
    node.url = url;
    node.code = dom.fileCode.value.trim();
    node.size = size;
    node.updatedAt = date;
    node.description = dom.fileDesc.value.trim();

    commit();
    closeDialog(dom.fileDialog);
    state.fileId = null;
    toast("文件已保存");
  }

  function deleteFileFromDialog() {
    var found = PanData.findNode(state.data.tree, state.fileId);
    if (!found) return;
    var node = found.node;
    if (!window.confirm("确定删除“" + node.name + "”吗？此操作可以撤销。")) return;
    removeNodeById(node.id);
    closeDialog(dom.fileDialog);
    state.fileId = null;
    commit();
    toast("文件已删除");
  }

  /* ---------------- JSON 视图 ---------------- */

  function setTab(tab) {
    state.tab = tab === "json" ? "json" : "folder";
    var isJson = state.tab === "json";
    dom.tabFolder.classList.toggle("is-active", !isJson);
    dom.tabJson.classList.toggle("is-active", isJson);
    dom.tabFolder.setAttribute("aria-selected", String(!isJson));
    dom.tabJson.setAttribute("aria-selected", String(isJson));
    show(dom.folderView, !isJson);
    show(dom.jsonView, isJson);
    if (isJson && !state.jsonDirty) renderJson();
  }

  function renderJson() {
    if (!dom.jsonText || !state.data) return;
    try {
      dom.jsonText.value = PanData.stringifyData(state.data);
      state.jsonDirty = false;
      show(dom.jsonErrors, false);
    } catch (error) {
      showJsonErrors("无法生成 JSON：" + error.message, []);
    }
  }

  function showJsonErrors(error, errors) {
    if (!dom.jsonErrors) return;
    clear(dom.jsonErrors);
    dom.jsonErrors.appendChild(el("p", null, error || "JSON 校验失败。"));
    if (errors && errors.length) {
      var list = el("ul");
      errors.slice(0, 8).forEach(function (item) {
        list.appendChild(el("li", null, item.path + "：" + item.message));
      });
      dom.jsonErrors.appendChild(list);
    }
    show(dom.jsonErrors, true);
  }

  function applyJson() {
    var result = PanData.parseJson(dom.jsonText.value, dataOptions());
    if (!result.ok) {
      showJsonErrors(result.error || "JSON 校验失败。", result.errors || []);
      toast("JSON 还有问题，没有应用", "error");
      return;
    }
    state.data = result.data;
    state.currentId = null;
    state.expanded = Object.create(null);
    state.page = 1;
    state.jsonDirty = false;
    resetHistory();
    state.dirty = true;
    saveDraftNow();
    renderAll();
    show(dom.jsonErrors, false);
    toast("JSON 已应用");
  }

  function refreshJson() {
    state.jsonDirty = false;
    renderJson();
  }

  /* ---------------- 草稿/导入/导出 ---------------- */

  function showBanner(title, text) {
    if (!dom.draftBanner) return;
    dom.draftTitle.textContent = title;
    dom.draftText.textContent = text;
    show(dom.draftBanner, true);
  }

  function hideBanner() {
    show(dom.draftBanner, false);
  }

  function showAlert(title, messages) {
    if (!dom.alertBox) return;
    dom.alertTitle.textContent = title;
    clear(dom.alertList);
    (messages || []).forEach(function (message) {
      dom.alertList.appendChild(el("li", null, message));
    });
    show(dom.alertBox, true);
    dom.alertBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideAlert() {
    show(dom.alertBox, false);
  }

  function loadOnlineData(clearDraft, notify) {
    if (dom.editStats) dom.editStats.textContent = "正在读取线上目录…";
    fetch(new URL("../data.json", window.location.href), { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);
        return response.text();
      })
      .then(function (text) {
        var result = PanData.parseJson(text, dataOptions());
        if (!result.ok) throw new Error(result.error || "数据格式不正确。");
        state.data = result.data;
        state.currentId = null;
        state.expanded = Object.create(null);
        state.page = 1;
        state.jsonDirty = false;
        state.dirty = false;
        if (clearDraft) removeDraft();
        resetHistory();
        renderAll();
        hideBanner();
        hideAlert();
        if (notify) toast("已重新载入线上目录");
      })
      .catch(function (error) {
        showAlert("读取线上目录失败", [
          error.message || String(error),
          "你仍然可以导入 JSON 或离线编辑；修改后记得导出 data.json。"
        ]);
        renderAll();
      });
  }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || "");
      var result = PanData.parseJson(text, dataOptions());
      if (!result.ok) {
        showAlert("导入失败", [result.error || "JSON 格式不正确。"].concat(
          (result.errors || []).slice(1, 6).map(function (item) {
            return item.path + "：" + item.message;
          })
        ));
        return;
      }
      state.data = result.data;
      state.currentId = null;
      state.expanded = Object.create(null);
      state.page = 1;
      state.jsonDirty = false;
      resetHistory();
      state.dirty = true;
      saveDraftNow();
      renderAll();
      hideAlert();
      toast("JSON 已导入");
    };
    reader.onerror = function () {
      showAlert("读取文件失败", ["浏览器没能读取这个 JSON 文件。"]);
    };
    reader.readAsText(file, "utf-8");
  }

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function exportData() {
    if (!state.data) return;
    var copy = clone(state.data);
    copy.updatedAt = PanData.todayLocal();
    var messages = [];
    if (!String(copy.title || "").trim()) {
      messages.push("$.title：标题不能为空。");
    }
    var result = PanData.validateData(copy, dataOptions());
    if (!result.ok) {
      result.errors.forEach(function (item) {
        messages.push(item.path + "：" + item.message);
      });
    }
    if (messages.length) {
      var shown = messages.slice(0, 10);
      if (messages.length > shown.length) {
        shown.push("还有 " + (messages.length - shown.length) + " 处问题，请用“只看缺失外链”检查。");
      }
      showAlert("还不能导出 data.json", shown);
      return;
    }

    state.data.updatedAt = copy.updatedAt;
    state.dirty = false;
    saveDraftNow();
    downloadText(PanData.stringifyData(copy), "data.json");
    toast("已导出 data.json，替换仓库里的 pan/data.json 后提交即可", "success");
  }

  /* ---------------- 扫描 ---------------- */

  function openScan() {
    if (!isLocal) return;
    if (!window.PanScan) {
      showAlert("无法扫描", ["扫描脚本没有加载，请确认 assets/js/pan-scan.js 存在。"]);
      return;
    }
    state.scanResult = null;
    state.scanning = false;
    state.cancelScan = false;
    show(dom.scanPreview, false);
    show(dom.scanProgress, false);
    dom.scanApply.disabled = true;
    dom.scanCancel.disabled = true;
    dom.scanCancel.textContent = "取消扫描";
    dom.scanPickDir.disabled = false;
    dom.scanPickFiles.disabled = false;
    clear(dom.scanNotes);
    openDialog(dom.scanDialog);
  }

  function resetScanProgress() {
    state.scanning = false;
    state.cancelScan = false;
    show(dom.scanProgress, false);
    dom.scanCancel.disabled = true;
    dom.scanCancel.textContent = "取消扫描";
    dom.scanPickDir.disabled = false;
    dom.scanPickFiles.disabled = false;
  }

  function runScan(start) {
    if (!window.PanScan || state.scanning) return;
    state.scanning = true;
    state.cancelScan = false;
    state.scanResult = null;
    show(dom.scanPreview, false);
    show(dom.scanProgress, true);
    dom.scanProgressText.textContent = "正在读取目录…";
    dom.scanProgressBar.style.width = "30%";
    dom.scanCancel.disabled = false;
    dom.scanPickDir.disabled = true;
    dom.scanPickFiles.disabled = true;
    dom.scanApply.disabled = true;

    var options = {
      shouldCancel: function () {
        return state.cancelScan;
      },
      onProgress: function (progress) {
        if (!progress) return;
        if (progress.phase === "building") {
          dom.scanProgressText.textContent = "正在整理目录结构，已读取 " + progress.entries + " 项";
        } else {
          var text = "已读取 " + (progress.entries || 0) + " 项";
          if (progress.path) text += " · " + progress.path;
          dom.scanProgressText.textContent = text;
        }
        dom.scanProgressBar.style.width = "68%";
      }
    };

    var promise;
    try {
      promise = start(options);
    } catch (error) {
      resetScanProgress();
      showAlert("扫描失败", [error.message || String(error)]);
      return;
    }

    Promise.resolve(promise).then(function (result) {
      state.scanResult = result;
      showScanPreview(result);
      resetScanProgress();
    }, function (error) {
      resetScanProgress();
      if (error && error.code === "SCAN_CANCELLED") {
        toast("已取消扫描", "warn");
        return;
      }
      showAlert("扫描失败", [
        error && error.message ? error.message : String(error),
        "如果文件夹特别大，可以先用 tools/scan_folder.py 在本地生成 JSON，再导入。"
      ]);
    });
  }

  function showScanPreview(result) {
    if (!result) return;
    var stats = result.stats || { folders: 0, files: 0, totalSize: 0 };
    dom.scanName.textContent = result.rootName || "扫描结果";
    dom.scanSummary.textContent = "共 " + (stats.folders || 0) + " 个文件夹、" +
      (stats.files || 0) + " 个文件，合计 " + PanData.formatSize(stats.totalSize || 0) + "。";
    clear(dom.scanNotes);
    (result.notes || []).forEach(function (note) {
      dom.scanNotes.appendChild(el("li", null, note));
    });
    dom.scanApply.disabled = false;
    show(dom.scanPreview, true);
  }

  function cancelScan() {
    if (!state.scanning) return;
    state.cancelScan = true;
    dom.scanProgressText.textContent = "正在取消…";
    dom.scanCancel.disabled = true;
  }

  function collectIdsOutside(tree, excludedChildren) {
    var ids = Object.create(null);
    function walk(nodes) {
      if (!Array.isArray(nodes) || nodes === excludedChildren) return;
      nodes.forEach(function (node) {
        if (!node || typeof node !== "object") return;
        if (typeof node.id === "string" && node.id) ids[node.id] = true;
        if (node.type === "folder" && Array.isArray(node.children)) {
          if (node.children !== excludedChildren) walk(node.children);
        }
      });
    }
    walk(tree);
    return ids;
  }

  function applyScan() {
    if (!state.scanResult) return;
    var modeInput = document.querySelector('input[name="scan-mode"]:checked');
    var mode = modeInput ? modeInput.value : "new";
    var tree = clone(state.scanResult.tree || []);
    var parent = getChildren();
    var reserved = mode === "replace"
      ? collectIdsOutside(state.data.tree, parent)
      : PanData.collectIds(state.data.tree);

    /* 扫描器的 ID 只基于扫描根内的相对路径；合并到子目录时可能与
       现有节点撞 ID。应用前先避开现有 ID，避免导出时校验失败。 */
    PanData.ensureUniqueIds(tree, reserved);

    if (mode === "new") {
      var folder = PanData.createFolder(
        PanData.uniqueName(parent, state.scanResult.rootName || "扫描结果"),
        tree
      );
      PanData.ensureUniqueIds([folder], PanData.collectIds(state.data.tree));
      parent.push(folder);
      state.currentId = folder.id;
      state.expanded[folder.id] = true;
    } else if (mode === "merge") {
      setCurrentChildren(PanData.mergeChildren(parent, tree));
    } else {
      setCurrentChildren(tree);
    }

    PanData.ensureUniqueIds(state.data.tree);
    state.page = 1;
    state.scanResult = null;
    closeDialog(dom.scanDialog);
    commit();
    toast(mode === "new" ? "扫描结果已作为新文件夹加入" : "扫描结果已应用");
  }

  function scanByPicker() {
    if (!window.PanScan) return;
    if (!PanScan.isPickerSupported()) {
      dom.scanDirInput.click();
      return;
    }
    runScan(function (options) {
      return PanScan.scanDirectoryPicker(options);
    });
  }

  function scanByFiles(fileList) {
    if (!fileList || !fileList.length) return;
    runScan(function (options) {
      return PanScan.scanFileList(fileList, Object.assign({}, options, { emptyFoldersLost: true }));
    });
  }

  function scanByDrop(dataTransfer) {
    if (!dataTransfer) return;
    runScan(function (options) {
      return PanScan.scanDataTransfer(dataTransfer, options);
    });
  }

  /* ---------------- 初始化与事件 ---------------- */

  function bindEvents() {
    dom.addFolder.addEventListener("click", addFolder);
    dom.addFile.addEventListener("click", addFile);
    dom.addFile2.addEventListener("click", addFile);
    dom.rootForm.addEventListener("submit", saveRoot);
    dom.folderForm.addEventListener("submit", saveFolder);
    dom.folderDelete.addEventListener("click", deleteCurrentFolder);
    dom.tabFolder.addEventListener("click", function () {
      setTab("folder");
    });
    dom.tabJson.addEventListener("click", function () {
      setTab("json");
    });
    dom.undoBtn.addEventListener("click", undo);
    dom.redoBtn.addEventListener("click", redo);

    dom.missingOnly.addEventListener("change", function () {
      state.filterMissing = dom.missingOnly.checked;
      state.page = 1;
      renderTable();
    });
    dom.prevPage.addEventListener("click", function () {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
      }
    });
    dom.nextPage.addEventListener("click", function () {
      state.page += 1;
      renderTable();
    });

    dom.exportBtn.addEventListener("click", exportData);
    dom.importOpen.addEventListener("click", function () {
      dom.importInput.click();
    });
    dom.importInput.addEventListener("change", function () {
      var file = dom.importInput.files && dom.importInput.files[0];
      importFile(file);
      dom.importInput.value = "";
    });

    dom.alertClose.addEventListener("click", hideAlert);

    dom.fileForm.addEventListener("submit", saveFile);
    dom.fileClose.addEventListener("click", function () {
      closeDialog(dom.fileDialog);
    });
    dom.fileCancel.addEventListener("click", function () {
      closeDialog(dom.fileDialog);
    });
    dom.fileDelete.addEventListener("click", deleteFileFromDialog);
    dom.fileUrl.addEventListener("input", updateFileUrlStatus);
    dom.fileDialog.addEventListener("click", function (event) {
      if (event.target === dom.fileDialog) closeDialog(dom.fileDialog);
    });
    dom.fileDialog.addEventListener("close", function () {
      state.fileId = null;
    });

    dom.jsonApply.addEventListener("click", applyJson);
    dom.jsonRefresh.addEventListener("click", refreshJson);
    dom.jsonText.addEventListener("input", function () {
      state.jsonDirty = true;
    });

    dom.scanOpen.addEventListener("click", openScan);
    dom.scanClose.addEventListener("click", function () {
      if (state.scanning) {
        toast("扫描还在进行，请先取消扫描", "warn");
        return;
      }
      closeDialog(dom.scanDialog);
    });
    dom.scanDismiss.addEventListener("click", function () {
      if (state.scanning) {
        toast("扫描还在进行，请先取消扫描", "warn");
        return;
      }
      closeDialog(dom.scanDialog);
    });
    dom.scanPickDir.addEventListener("click", scanByPicker);
    dom.scanPickFiles.addEventListener("click", function () {
      dom.scanFilesInput.click();
    });
    dom.scanDirInput.addEventListener("change", function () {
      var files = dom.scanDirInput.files;
      scanByFiles(files);
      dom.scanDirInput.value = "";
    });
    dom.scanFilesInput.addEventListener("change", function () {
      var files = dom.scanFilesInput.files;
      scanByFiles(files);
      dom.scanFilesInput.value = "";
    });
    dom.scanCancel.addEventListener("click", cancelScan);
    dom.scanApply.addEventListener("click", applyScan);

    ["dragenter", "dragover"].forEach(function (name) {
      dom.scanDrop.addEventListener(name, function (event) {
        event.preventDefault();
        dom.scanDrop.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      dom.scanDrop.addEventListener(name, function (event) {
        event.preventDefault();
        dom.scanDrop.classList.remove("is-over");
      });
    });
    dom.scanDrop.addEventListener("drop", function (event) {
      scanByDrop(event.dataTransfer);
    });

    dom.draftUseOnline.addEventListener("click", function () {
      if (isLocal) return;
      if (!window.confirm("重新载入线上 data.json？当前草稿会被丢弃。")) return;
      loadOnlineData(true, true);
    });
    dom.draftClear.addEventListener("click", function () {
      if (isLocal) {
        if (!window.confirm("清空当前编辑内容？这会删除本地草稿。")) return;
        removeDraft();
        state.data = emptyData();
        state.currentId = null;
        state.expanded = Object.create(null);
        state.page = 1;
        state.jsonDirty = false;
        resetHistory();
        state.dirty = false;
        renderAll();
        showBanner("本地离线模式", "扫描文件夹或导入 JSON 开始。内容只保存在这个浏览器，不会上传。");
        return;
      }
      if (!window.confirm("清空草稿并重新载入线上 data.json？")) return;
      loadOnlineData(true, true);
    });

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "s") {
        event.preventDefault();
        exportData();
      }
    });

    window.addEventListener("beforeunload", function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function applyMode() {
    show(dom.scanOpen, isLocal);
    if (isLocal) {
      show(dom.draftUseOnline, false);
      dom.draftClear.textContent = "清空内容";
    } else {
      dom.draftUseOnline.textContent = "重新载入线上数据";
      dom.draftClear.textContent = "清空草稿";
    }
  }

  function loadInitial() {
    if (isLocal) {
      var localDraft = getDraft();
      if (localDraft) {
        state.data = localDraft;
        state.dirty = false;
        resetHistory();
        renderAll();
        showBanner("已恢复本地草稿", "草稿只保存在这个浏览器里；修改后请及时导出 data.json。");
      } else {
        state.data = emptyData();
        resetHistory();
        renderAll();
        showBanner("本地离线模式", "扫描文件夹或导入 JSON 开始。内容只保存在这个浏览器，不会上传。");
      }
      return;
    }

    var draft = getDraft();
    if (draft) {
      state.data = draft;
      state.dirty = false;
      resetHistory();
      renderAll();
      showBanner("已恢复本地草稿", "你可以继续编辑，或重新读取线上 data.json。");
      return;
    }

    state.data = emptyData();
    resetHistory();
    renderAll();
    loadOnlineData(false, false);
  }

  function init() {
    cacheDom();
    bindEvents();
    applyMode();
    loadInitial();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
