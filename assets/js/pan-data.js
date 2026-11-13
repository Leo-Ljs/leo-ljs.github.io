/* =========================================================
   pan-data.js · 网盘数据层
   纯函数，无 DOM 依赖；浏览器挂到 window.PanData，
   也通过 module.exports 供 Node 单元测试使用。
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PanData = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var TYPE = "leoljs-pan";
  var LIMITS = Object.freeze({
    maxNodes: 30000,
    maxBytes: 10 * 1024 * 1024,
    maxDepth: 20
  });

  var UNSAFE_KEYS = Object.create(null);
  UNSAFE_KEYS["__proto__"] = true;
  UNSAFE_KEYS.prototype = true;
  UNSAFE_KEYS.constructor = true;

  function isSafeKey(key) {
    return typeof key === "string" && !UNSAFE_KEYS[key];
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function utf8ByteLength(text) {
    var value = String(text);
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(value).length;
    }
    var bytes = 0;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    }
    return bytes;
  }

  function todayLocal() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, "0");
    var day = String(now.getDate()).padStart(2, "0");
    return now.getFullYear() + "-" + month + "-" + day;
  }

  function isValidDateString(value) {
    if (typeof value !== "string") return false;
    var match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!match) return false;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    var probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }

  function cloneSafe(value, stack) {
    if (value === null || typeof value !== "object") return value;
    var trail = stack || [];
    if (trail.indexOf(value) !== -1) {
      throw new Error("数据包含循环引用，无法序列化。");
    }
    if (Array.isArray(value)) {
      trail.push(value);
      var list = value.map(function (item) {
        return cloneSafe(item, trail);
      });
      trail.pop();
      return list;
    }
    if (!isPlainObject(value)) return value;
    trail.push(value);
    var output = {};
    Object.keys(value).forEach(function (key) {
      if (!isSafeKey(key)) return;
      output[key] = cloneSafe(value[key], trail);
    });
    trail.pop();
    return output;
  }

  function sanitizeData(value) {
    return cloneSafe(value);
  }

  function createEmptyData(overrides) {
    var base = {
      schemaVersion: SCHEMA_VERSION,
      type: TYPE,
      title: "Leo 的网盘",
      notice: "",
      updatedAt: todayLocal(),
      tree: []
    };
    if (!overrides) return base;
    Object.keys(overrides).forEach(function (key) {
      if (isSafeKey(key)) base[key] = overrides[key];
    });
    return base;
  }

  function checkExternalUrl(raw, options) {
    var opts = typeof options === "string" ? { origin: options } : options || {};
    if (typeof raw !== "string" || !raw.trim()) {
      return { ok: false, reason: "下载链接不能为空。" };
    }
    var parsed;
    try {
      parsed = new URL(raw.trim());
    } catch (error) {
      return { ok: false, reason: "下载链接不是合法的网址。" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "下载链接必须以 http:// 或 https:// 开头。" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: "下载链接里不要包含账号或密码。" };
    }

    var selfHosts = [];
    function addHost(candidate) {
      if (!candidate) return;
      var raw = String(candidate).trim();
      if (!raw) return;
      var host = "";
      try {
        host = new URL(raw).hostname.toLowerCase();
      } catch (error) {
        host = raw.split("/")[0].split(":")[0].toLowerCase();
      }
      if (host && selfHosts.indexOf(host) === -1) selfHosts.push(host);
    }
    addHost(opts.origin);
    if (Array.isArray(opts.siteHosts)) opts.siteHosts.forEach(addHost);
    if (selfHosts.indexOf(parsed.hostname.toLowerCase()) !== -1) {
      return { ok: false, reason: "不能使用本站地址，请填写蓝奏云等外部网盘链接。" };
    }
    return { ok: true, url: parsed.href };
  }

  function validateData(data, options) {
    var opts = options || {};
    var errors = [];
    var warnings = [];
    var stats = { nodes: 0, folders: 0, files: 0, bytes: 0, maxDepth: 0 };
    var ids = Object.create(null);
    var seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    function addError(path, message) {
      errors.push({ path: path, message: message });
    }

    if (!isPlainObject(data)) {
      addError("$", "根数据必须是一个对象。");
      return { ok: false, errors: errors, warnings: warnings, stats: stats };
    }
    if (data.schemaVersion !== SCHEMA_VERSION) {
      addError("$.schemaVersion", "schemaVersion 必须是 " + SCHEMA_VERSION + "。");
    }
    if (data.type !== TYPE) {
      addError("$.type", "type 必须是 \"" + TYPE + "\"。");
    }
    if (typeof data.title !== "string") {
      addError("$.title", "title 必须是字符串。");
    }
    if (data.notice != null && typeof data.notice !== "string") {
      addError("$.notice", "notice 必须是字符串。");
    }
    if (data.updatedAt != null && !isValidDateString(data.updatedAt)) {
      addError("$.updatedAt", "updatedAt 必须是 YYYY-MM-DD 格式的日期。");
    }
    if (!Array.isArray(data.tree)) {
      addError("$.tree", "tree 必须是数组。");
      return { ok: false, errors: errors, warnings: warnings, stats: stats };
    }

    function walk(nodes, depth, parentPath) {
      if (!Array.isArray(nodes)) {
        addError(parentPath, "children 必须是数组。");
        return;
      }
      if (depth > LIMITS.maxDepth) {
        addError(parentPath, "目录层级超过 " + LIMITS.maxDepth + " 层。");
        return;
      }
      nodes.forEach(function (node, index) {
        var path = parentPath + "[" + index + "]";
        stats.nodes += 1;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        if (stats.nodes > LIMITS.maxNodes) {
          if (stats.nodes === LIMITS.maxNodes + 1) {
            addError(path, "节点数量超过 " + LIMITS.maxNodes + " 个。");
          }
          return;
        }
        if (!isPlainObject(node)) {
          addError(path, "节点必须是对象。");
          return;
        }
        if (seen) {
          if (seen.has(node)) {
            addError(path, "数据中存在循环引用。");
            return;
          }
          seen.add(node);
        }
        var type = node.type;
        if (type !== "folder" && type !== "file") {
          addError(path + ".type", "type 只能是 folder 或 file。");
          return;
        }
        if (typeof node.id !== "string" || !node.id.trim()) {
          addError(path + ".id", "id 不能为空。");
        } else if (ids[node.id]) {
          addError(path + ".id", "id 重复：\"" + node.id + "\" 已在 " + ids[node.id] + " 使用。");
        } else {
          ids[node.id] = path;
        }
        if (typeof node.name !== "string" || !node.name.trim()) {
          addError(path + ".name", "名称不能为空。");
        } else if (node.name.length > 255) {
          warnings.push({ path: path + ".name", message: "名称超过 255 个字符，部分系统可能无法显示。" });
        }
        if (node.description != null && typeof node.description !== "string") {
          addError(path + ".description", "description 必须是字符串。");
        }

        if (type === "folder") {
          stats.folders += 1;
          if (!Array.isArray(node.children)) {
            addError(path + ".children", "文件夹必须包含 children 数组。");
          } else {
            walk(node.children, depth + 1, path + ".children");
          }
          return;
        }

        stats.files += 1;
        var urlCheck = checkExternalUrl(node.url, opts);
        if (!urlCheck.ok) addError(path + ".url", urlCheck.reason);
        if (node.code != null && typeof node.code !== "string") {
          addError(path + ".code", "code 必须是字符串。");
        }
        if (node.size != null) {
          if (typeof node.size !== "number" || !isFinite(node.size) || node.size < 0) {
            addError(path + ".size", "size 必须是非负数字（字节）。");
          }
        }
        if (node.updatedAt != null && !isValidDateString(node.updatedAt)) {
          addError(path + ".updatedAt", "updatedAt 必须是 YYYY-MM-DD 格式的日期。");
        }
      });
    }

    walk(data.tree, 1, "$.tree");

    try {
      stats.bytes = utf8ByteLength(JSON.stringify(data, null, 2));
    } catch (error) {
      addError("$", "数据无法序列化：" + error.message);
      stats.bytes = 0;
    }
    if (stats.bytes > LIMITS.maxBytes) {
      addError("$", "数据超过 " + Math.round(LIMITS.maxBytes / 1024 / 1024) + " MB 限制。");
    }
    if (stats.nodes > LIMITS.maxNodes && !errors.some(function (item) {
      return item.message.indexOf("节点数量超过") !== -1;
    })) {
      addError("$.tree", "节点数量超过 " + LIMITS.maxNodes + " 个。");
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      stats: stats
    };
  }

  function parseJson(text, options) {
    if (typeof text !== "string") {
      return { ok: false, error: "JSON 内容必须是字符串。", errors: [] };
    }
    if (utf8ByteLength(text) > LIMITS.maxBytes) {
      return { ok: false, error: "文件超过 10 MB 限制。", errors: [] };
    }
    var parsed;
    try {
      parsed = JSON.parse(text, function (key, value) {
        if (key && !isSafeKey(key)) return undefined;
        return value;
      });
    } catch (error) {
      return { ok: false, error: "JSON 解析失败：" + error.message, errors: [] };
    }
    var result = validateData(parsed, options);
    if (!result.ok) {
      return {
        ok: false,
        error: result.errors[0].path + "：" + result.errors[0].message,
        errors: result.errors,
        warnings: result.warnings,
        stats: result.stats,
        data: parsed
      };
    }
    return {
      ok: true,
      data: parsed,
      errors: [],
      warnings: result.warnings,
      stats: result.stats
    };
  }

  function stringifyData(data) {
    return JSON.stringify(data, null, 2) + "\n";
  }

  function formatSize(bytes) {
    if (bytes == null || bytes === "") return "—";
    var value = Number(bytes);
    if (!isFinite(value) || value < 0) return "—";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    var digits = index === 0 || value >= 100 ? 0 : 1;
    return value.toFixed(digits) + " " + units[index];
  }

  function formatDate(value) {
    if (value == null || value === "") return "—";
    if (typeof value !== "string") return "—";
    return isValidDateString(value) ? value.slice(0, 10) : "—";
  }

  function fnv1a(text) {
    var bytes = new TextEncoder().encode(String(text));
    var hash = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return ("0000000" + hash.toString(16)).slice(-8);
  }

  /**
   * 由相对路径生成稳定 ID。folder 会额外加上末尾斜杠参与哈希，
   * 避免同名文件与文件夹产生同一个 ID。
   * used 传入已占用的 id 表时，会自动追加 -2、-3 处理碰撞。
   */
  function makeId(relativePath, isFolder, used) {
    var key = String(relativePath == null ? "" : relativePath)
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (isFolder) key += "/";
    var base = "n_" + fnv1a(key);
    if (!used) return base;
    var id = base;
    var attempt = 2;
    while (used[id]) {
      id = base + "-" + attempt;
      attempt += 1;
    }
    used[id] = true;
    return id;
  }

  function makeManualId() {
    var uuid = "";
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      uuid = crypto.randomUUID();
    } else {
      uuid = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
    return "n_" + uuid;
  }

  function createFolder(name, children) {
    return {
      id: makeManualId(),
      type: "folder",
      name: name || "新建文件夹",
      description: "",
      children: Array.isArray(children) ? children : []
    };
  }

  function createFile(values) {
    var source = values || {};
    return {
      id: source.id || makeManualId(),
      type: "file",
      name: source.name || "新建文件",
      url: source.url || "",
      code: source.code || "",
      size: source.size == null ? null : source.size,
      updatedAt: source.updatedAt || todayLocal(),
      description: source.description || ""
    };
  }

  function uniqueName(children, name) {
    var base = String(name || "").trim() || "未命名";
    var used = Object.create(null);
    (Array.isArray(children) ? children : []).forEach(function (node) {
      if (node && typeof node.name === "string") used[node.name] = true;
    });
    if (!used[base]) return base;
    var attempt = 2;
    while (used[base + " (" + attempt + ")"]) attempt += 1;
    return base + " (" + attempt + ")";
  }

  function locate(nodes, id, ancestors) {
    if (!Array.isArray(nodes)) return null;
    var trail = ancestors || [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || typeof node !== "object") continue;
      var path = trail.concat(node);
      if (node.id === id) {
        return {
          node: node,
          parent: trail.length ? trail[trail.length - 1] : null,
          index: i,
          path: path
        };
      }
      if (node.type === "folder" && Array.isArray(node.children)) {
        var found = locate(node.children, id, path);
        if (found) return found;
      }
    }
    return null;
  }

  function findNode(tree, id) {
    return locate(tree, id, []);
  }

  function flattenTree(tree) {
    var output = [];
    function walk(nodes, depth, ancestors) {
      if (!Array.isArray(nodes)) return;
      nodes.forEach(function (node) {
        if (!node || typeof node !== "object") return;
        var path = ancestors.concat(node);
        output.push({ node: node, depth: depth, path: path });
        if (node.type === "folder" && Array.isArray(node.children)) {
          walk(node.children, depth + 1, path);
        }
      });
    }
    walk(tree, 1, []);
    return output;
  }

  function searchTree(tree, query, limit) {
    var needle = String(query || "").trim().toLowerCase();
    var max = typeof limit === "number" && limit > 0 ? limit : 300;
    if (!needle) return [];
    var results = [];
    var items = flattenTree(tree);
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var node = item.node;
      var haystack = String(node.name || "") + "\n" + String(node.description || "");
      if (haystack.toLowerCase().indexOf(needle) === -1) continue;
      results.push({
        node: node,
        depth: item.depth,
        path: item.path.slice(0, -1)
      });
      if (results.length >= max) break;
    }
    return results;
  }

  function sortNodes(nodes, mode, direction) {
    var list = Array.isArray(nodes) ? nodes.slice() : [];
    var field = mode === "size" || mode === "updated" ? mode : "name";
    var descending = direction === "desc";
    list.sort(function (a, b) {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      var compared = 0;
      if (field === "name") {
        compared = String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", {
          numeric: true,
          sensitivity: "base"
        });
      } else if (field === "size") {
        compared = Number(a.size || 0) - Number(b.size || 0);
      } else {
        compared = String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
      }
      if (compared === 0) {
        compared = String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", {
          numeric: true,
          sensitivity: "base"
        });
      }
      return descending ? -compared : compared;
    });
    return list;
  }

  function mergeChildren(existingChildren, incomingChildren) {
    var oldList = Array.isArray(existingChildren) ? existingChildren : [];
    var newList = Array.isArray(incomingChildren) ? incomingChildren : [];
    var index = Object.create(null);
    oldList.forEach(function (node) {
      if (node && node.type && node.name) index[node.type + "\u0000" + node.name] = node;
    });
    var consumed = Object.create(null);
    var output = [];

    newList.forEach(function (incoming) {
      if (!incoming || !incoming.type || !incoming.name) return;
      var key = incoming.type + "\u0000" + incoming.name;
      var current = index[key];
      if (!current) {
        output.push(incoming);
        return;
      }
      consumed[key] = true;
      if (incoming.type === "folder") {
        var merged = Object.assign({}, incoming, current);
        merged.id = current.id;
        merged.name = current.name;
        merged.type = "folder";
        merged.description = current.description || incoming.description || "";
        merged.children = mergeChildren(current.children, incoming.children);
        output.push(merged);
      } else {
        var file = Object.assign({}, incoming, current);
        file.id = current.id;
        file.name = current.name;
        file.type = "file";
        file.url = current.url || incoming.url || "";
        file.code = current.code || incoming.code || "";
        file.description = current.description || incoming.description || "";
        file.size = incoming.size != null ? incoming.size : current.size;
        file.updatedAt = incoming.updatedAt || current.updatedAt;
        output.push(file);
      }
    });

    oldList.forEach(function (node) {
      if (!node || !node.type || !node.name) return;
      var key = node.type + "\u0000" + node.name;
      if (!consumed[key]) output.push(node);
    });
    return output;
  }

  function collectIds(nodes, output) {
    var ids = output || Object.create(null);
    function walk(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (node) {
        if (!node || typeof node !== "object") return;
        if (typeof node.id === "string" && node.id) ids[node.id] = true;
        if (node.type === "folder" && Array.isArray(node.children)) walk(node.children);
      });
    }
    walk(nodes);
    return ids;
  }

  function ensureUniqueIds(nodes, reserved) {
    var used = Object.assign(Object.create(null), reserved || {});
    function walk(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (node) {
        if (!node || typeof node !== "object") return;
        var id = typeof node.id === "string" ? node.id.trim() : "";
        if (!id) id = makeManualId();
        if (used[id]) {
          var base = id;
          var attempt = 2;
          while (used[base + "-" + attempt]) attempt += 1;
          id = base + "-" + attempt;
        }
        node.id = id;
        used[id] = true;
        if (node.type === "folder" && Array.isArray(node.children)) walk(node.children);
      });
    }
    walk(nodes);
    return used;
  }

  function collectStats(data) {
    var stats = { nodes: 0, folders: 0, files: 0, bytes: 0, maxDepth: 0 };
    if (!data || !Array.isArray(data.tree)) return stats;
    function walk(nodes, depth) {
      nodes.forEach(function (node) {
        if (!node || typeof node !== "object") return;
        stats.nodes += 1;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        if (node.type === "folder") {
          stats.folders += 1;
          if (Array.isArray(node.children)) walk(node.children, depth + 1);
        } else if (node.type === "file") {
          stats.files += 1;
        }
      });
    }
    walk(data.tree, 1);
    try {
      stats.bytes = utf8ByteLength(JSON.stringify(data, null, 2));
    } catch (error) {
      stats.bytes = 0;
    }
    return stats;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    TYPE: TYPE,
    LIMITS: LIMITS,
    isSafeKey: isSafeKey,
    isPlainObject: isPlainObject,
    isValidDateString: isValidDateString,
    utf8ByteLength: utf8ByteLength,
    todayLocal: todayLocal,
    sanitizeData: sanitizeData,
    createEmptyData: createEmptyData,
    checkExternalUrl: checkExternalUrl,
    validateData: validateData,
    parseJson: parseJson,
    stringifyData: stringifyData,
    formatSize: formatSize,
    formatDate: formatDate,
    makeId: makeId,
    makeManualId: makeManualId,
    createFolder: createFolder,
    createFile: createFile,
    uniqueName: uniqueName,
    findNode: findNode,
    flattenTree: flattenTree,
    searchTree: searchTree,
    sortNodes: sortNodes,
    mergeChildren: mergeChildren,
    collectIds: collectIds,
    ensureUniqueIds: ensureUniqueIds,
    collectStats: collectStats
  };
});
