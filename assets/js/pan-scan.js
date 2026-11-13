/* =========================================================
   pan-scan.js · 把本地目录扫描成网盘数据结构
   只读取名称、大小、修改时间，不读取文件内容，不上传。
   纯构建函数可在 Node 中测试；浏览器 API 部分做能力检测。
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./pan-data.js"));
  } else {
    root.PanScan = factory(root.PanData);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (PanData) {
  "use strict";

  if (!PanData) throw new Error("PanScan 需要先加载 pan-data.js");

  var LIMITS = PanData.LIMITS;

  function scanError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function cancelledError() {
    return scanError("SCAN_CANCELLED", "扫描已取消。");
  }

  function checkCancel(shouldCancel) {
    if (typeof shouldCancel === "function" && shouldCancel()) throw cancelledError();
  }

  function normalizeRelativePath(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(function (part) {
        return part && part !== ".";
      })
      .join("/");
  }

  function dateFromMs(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "";
    var date = new Date(ms);
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function compareNodes(a, b) {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  }

  function normalizeEntries(rawEntries, options) {
    var opts = options || {};
    var list = [];
    var seen = Object.create(null);
    (Array.isArray(rawEntries) ? rawEntries : []).forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      var path = normalizeRelativePath(entry.path);
      if (!path) return;
      var segments = path.split("/");
      if (segments.some(function (part) { return part === ".."; })) return;
      var type = entry.type === "directory" ? "directory" : "file";
      var key = type + "\u0000" + path;
      if (seen[key]) return;
      seen[key] = true;
      list.push({
        path: path,
        type: type,
        size: Number(entry.size) || 0,
        lastModified: Number(entry.lastModified) || 0
      });
    });
    return list;
  }

  /**
   * 纯构建函数：把 [{path,type,size,lastModified}] 变成网盘 tree。
   * options: { rootName, emptyFoldersLost, notes, shouldCancel, onProgress }
   */
  function buildTree(rawEntries, options) {
    var opts = options || {};
    var rootName = String(opts.rootName || "").trim() || "扫描结果";
    var entries = normalizeEntries(rawEntries, opts);
    entries.sort(function (a, b) {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.type === "directory" ? -1 : 1;
    });

    var root = { children: [] };
    var dirMap = Object.create(null);
    dirMap[""] = root;
    var stats = { nodes: 0, folders: 0, files: 0, totalSize: 0, maxDepth: 0 };
    var usedIds = Object.create(null);

    function abortIfNeeded() {
      checkCancel(opts.shouldCancel);
    }

    function ensureDir(segments) {
      var key = "";
      var parent = root;
      for (var i = 0; i < segments.length; i++) {
        var name = segments[i];
        var nextKey = key ? key + "/" + name : name;
        var depth = i + 1;
        if (depth > LIMITS.maxDepth) {
          throw scanError("SCAN_LIMIT", "目录层级超过 " + LIMITS.maxDepth + " 层。");
        }
        if (dirMap[nextKey]) {
          parent = dirMap[nextKey];
          key = nextKey;
          continue;
        }
        var existing = null;
        for (var j = 0; j < parent.children.length; j++) {
          if (parent.children[j].name === name) {
            existing = parent.children[j];
            break;
          }
        }
        if (existing && existing.type !== "folder") {
          throw scanError("SCAN_INVALID", "路径冲突：\"" + name + "\" 既是文件又是文件夹。");
        }
        if (existing) {
          dirMap[nextKey] = existing;
          parent = existing;
          key = nextKey;
          continue;
        }
        var folder = {
          id: "",
          type: "folder",
          name: name,
          description: "",
          children: []
        };
        parent.children.push(folder);
        dirMap[nextKey] = folder;
        parent = folder;
        key = nextKey;
        stats.nodes += 1;
        stats.folders += 1;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        if (stats.nodes > LIMITS.maxNodes) {
          throw scanError("SCAN_LIMIT", "文件数量超过 " + LIMITS.maxNodes + " 个。");
        }
      }
      return parent;
    }

    entries.forEach(function (entry) {
      abortIfNeeded();
      var segments = entry.path.split("/");
      if (segments.length > LIMITS.maxDepth) {
        throw scanError("SCAN_LIMIT", "目录层级超过 " + LIMITS.maxDepth + " 层。");
      }
      if (entry.type === "directory") {
        ensureDir(segments);
        return;
      }
      var parent = ensureDir(segments.slice(0, -1));
      var name = segments[segments.length - 1];
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].name === name) {
          if (parent.children[i].type === "folder") {
            throw scanError("SCAN_INVALID", "路径冲突：\"" + name + "\" 既是文件又是文件夹。");
          }
          return;
        }
      }
      var file = {
        id: "",
        type: "file",
        name: name,
        url: "",
        code: "",
        size: entry.size,
        description: ""
      };
      var updatedAt = dateFromMs(entry.lastModified);
      if (updatedAt) file.updatedAt = updatedAt;
      parent.children.push(file);
      stats.nodes += 1;
      stats.files += 1;
      stats.totalSize += entry.size;
      stats.maxDepth = Math.max(stats.maxDepth, segments.length);
      if (stats.nodes > LIMITS.maxNodes) {
        throw scanError("SCAN_LIMIT", "文件数量超过 " + LIMITS.maxNodes + " 个。");
      }
    });

    function sortTree(nodes) {
      nodes.sort(compareNodes);
      nodes.forEach(function (node) {
        if (node.type === "folder") sortTree(node.children);
      });
    }

    function assignIds(nodes, parentPath) {
      nodes.forEach(function (node) {
        var relative = parentPath ? parentPath + "/" + node.name : node.name;
        node.id = PanData.makeId(relative, node.type === "folder", usedIds);
        if (node.type === "folder") assignIds(node.children, relative);
      });
    }

    sortTree(root.children);
    assignIds(root.children, "");

    if (typeof opts.onProgress === "function") {
      opts.onProgress({ phase: "building", entries: stats.nodes });
    }

    return {
      rootName: rootName,
      tree: root.children,
      stats: stats,
      emptyFoldersLost: Boolean(opts.emptyFoldersLost),
      notes: Array.isArray(opts.notes) ? opts.notes.slice() : [],
      method: opts.method || "build"
    };
  }

  function isPickerSupported() {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  }

  function readAllEntries(reader) {
    return new Promise(function (resolve, reject) {
      var collected = [];
      function next() {
        reader.readEntries(function (batch) {
          if (!batch.length) {
            resolve(collected);
            return;
          }
          collected = collected.concat(Array.prototype.slice.call(batch));
          next();
        }, reject);
      }
      next();
    });
  }

  function entryFile(entry) {
    return new Promise(function (resolve, reject) {
      entry.file(resolve, reject);
    });
  }

  function makeCollector(options) {
    var opts = options || {};
    var entries = [];
    var lastEmit = 0;
    var count = 0;
    var totalSize = 0;

    function emit(path, force) {
      if (typeof opts.onProgress !== "function") return;
      var now = Date.now();
      if (!force && now - lastEmit < 120) return;
      lastEmit = now;
      opts.onProgress({
        phase: "scanning",
        entries: count,
        path: path,
        totalSize: totalSize
      });
    }

    function add(entry) {
      checkCancel(opts.shouldCancel);
      entries.push(entry);
      count += 1;
      if (entry.size) totalSize += entry.size;
      if (count > LIMITS.maxNodes) {
        throw scanError("SCAN_LIMIT", "文件数量超过 " + LIMITS.maxNodes + " 个。");
      }
      emit(entry.path, false);
    }

    return {
      entries: entries,
      add: add,
      emit: emit,
      get count() {
        return count;
      },
      get totalSize() {
        return totalSize;
      }
    };
  }

  function checkDepth(path) {
    var depth = normalizeRelativePath(path).split("/").filter(Boolean).length;
    if (depth > LIMITS.maxDepth) {
      throw scanError("SCAN_LIMIT", "目录层级超过 " + LIMITS.maxDepth + " 层。");
    }
  }

  async function walkDirectoryHandle(handle, prefix, collector, options) {
    var opts = options || {};
    for await (var pair of handle.entries()) {
      checkCancel(opts.shouldCancel);
      var name = pair[0];
      var child = pair[1];
      var path = prefix ? prefix + "/" + name : name;
      checkDepth(path);
      if (child.kind === "directory") {
        collector.add({ path: path, type: "directory" });
        await walkDirectoryHandle(child, path, collector, opts);
      } else {
        var file = await child.getFile();
        collector.add({
          path: path,
          type: "file",
          size: file.size,
          lastModified: file.lastModified
        });
      }
    }
  }

  async function scanDirectoryPicker(options) {
    var opts = options || {};
    if (!isPickerSupported()) {
      throw scanError("SCAN_UNSUPPORTED", "当前浏览器不支持目录选择，请使用文件选择或拖拽。");
    }
    var handle;
    try {
      handle = await window.showDirectoryPicker({ mode: "read" });
    } catch (error) {
      if (error && error.name === "AbortError") throw cancelledError();
      if (error && error.name === "SecurityError") {
        throw scanError("SCAN_UNSUPPORTED", "浏览器拒绝了目录访问，请换用文件选择或拖拽。");
      }
      throw error;
    }
    var collector = makeCollector(opts);
    collector.emit("", true);
    await walkDirectoryHandle(handle, "", collector, opts);
    collector.emit("", true);
    return buildTree(collector.entries, {
      rootName: handle.name,
      emptyFoldersLost: false,
      notes: [],
      shouldCancel: opts.shouldCancel,
      onProgress: opts.onProgress,
      method: "directory-picker"
    });
  }

  async function scanFileList(fileList, options) {
    var opts = options || {};
    var files = Array.prototype.slice.call(fileList || []);
    var collector = makeCollector(opts);
    var relativeList = files.map(function (file) {
      return normalizeRelativePath(file.webkitRelativePath || "");
    });
    var firstRelative = relativeList.find(function (value) { return Boolean(value); }) || "";
    var rootName = String(opts.rootName || "").trim();
    var stripRoot = "";

    if (firstRelative) {
      stripRoot = firstRelative.split("/")[0];
      if (!rootName) rootName = stripRoot;
    } else if (!rootName) {
      rootName = "扫描结果";
    }

    files.forEach(function (file, index) {
      checkCancel(opts.shouldCancel);
      var relative = relativeList[index];
      if (!relative) relative = normalizeRelativePath(file.name);
      if (stripRoot) {
        var parts = relative.split("/");
        if (parts[0] === stripRoot) relative = parts.slice(1).join("/");
      }
      if (!relative) return;
      checkDepth(relative);
      collector.add({
        path: relative,
        type: "file",
        size: file.size,
        lastModified: file.lastModified
      });
    });
    collector.emit("", true);

    return buildTree(collector.entries, {
      rootName: rootName,
      emptyFoldersLost: Boolean(opts.emptyFoldersLost),
      notes: opts.emptyFoldersLost
        ? ["浏览器文件选择无法保留空文件夹；需要保留时请改用“选择文件夹”或拖拽。"]
        : [],
      shouldCancel: opts.shouldCancel,
      onProgress: opts.onProgress,
      method: "file-input"
    });
  }

  async function walkEntry(entry, relPath, collector, options, includeSelf) {
    var opts = options || {};
    checkCancel(opts.shouldCancel);
    if (!entry) return;
    if (entry.isDirectory) {
      checkDepth(relPath);
      if (includeSelf) collector.add({ path: relPath, type: "directory" });
      var children = await readAllEntries(entry.createReader());
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        var childPath = relPath ? relPath + "/" + child.name : child.name;
        await walkEntry(child, childPath, collector, opts, true);
      }
      return;
    }
    if (entry.isFile) {
      checkDepth(relPath);
      var file = await entryFile(entry);
      collector.add({
        path: relPath,
        type: "file",
        size: file.size,
        lastModified: file.lastModified
      });
    }
  }

  async function scanDataTransfer(dataTransfer, options) {
    var opts = options || {};
    var items = dataTransfer && dataTransfer.items ? Array.prototype.slice.call(dataTransfer.items) : [];
    var roots = [];
    items.forEach(function (item) {
      if (item.kind !== "file" || typeof item.webkitGetAsEntry !== "function") return;
      var entry = item.webkitGetAsEntry();
      if (entry) roots.push(entry);
    });

    if (!roots.length) {
      if (dataTransfer && dataTransfer.files && dataTransfer.files.length) {
        return scanFileList(dataTransfer.files, {
          rootName: opts.rootName || "扫描结果",
          emptyFoldersLost: true,
          shouldCancel: opts.shouldCancel,
          onProgress: opts.onProgress
        });
      }
      throw scanError("SCAN_EMPTY", "没有读取到可扫描的文件或文件夹。");
    }

    var collector = makeCollector(opts);
    var rootName = String(opts.rootName || "").trim() || "扫描结果";
    if (roots.length === 1 && roots[0].isDirectory) {
      rootName = roots[0].name;
      var children = await readAllEntries(roots[0].createReader());
      for (var i = 0; i < children.length; i++) {
        await walkEntry(children[i], children[i].name, collector, opts, true);
      }
    } else {
      for (var j = 0; j < roots.length; j++) {
        await walkEntry(roots[j], roots[j].name, collector, opts, true);
      }
    }
    collector.emit("", true);

    return buildTree(collector.entries, {
      rootName: rootName,
      emptyFoldersLost: false,
      notes: [],
      shouldCancel: opts.shouldCancel,
      onProgress: opts.onProgress,
      method: "drag-drop"
    });
  }

  return {
    buildTree: buildTree,
    normalizeRelativePath: normalizeRelativePath,
    dateFromMs: dateFromMs,
    isPickerSupported: isPickerSupported,
    scanDirectoryPicker: scanDirectoryPicker,
    scanFileList: scanFileList,
    scanDataTransfer: scanDataTransfer
  };
});
