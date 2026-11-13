import test from "node:test";
import assert from "node:assert/strict";
import PanData from "../assets/js/pan-data.js";

function baseData(tree) {
  return {
    schemaVersion: 1,
    type: "leoljs-pan",
    title: "测试网盘",
    notice: "",
    updatedAt: "2026-11-13",
    tree: tree || []
  };
}

function file(id, name, url, extra) {
  return Object.assign(
    {
      id: id,
      type: "file",
      name: name,
      url: url,
      code: "",
      size: 1024,
      updatedAt: "2026-11-01",
      description: ""
    },
    extra || {}
  );
}

test("validateData 接受合法数据", () => {
  const data = baseData([
    {
      id: "d1",
      type: "folder",
      name: "资料",
      description: "",
      children: [file("f1", "笔记.pdf", "https://example.com/a.pdf")]
    }
  ]);
  const result = PanData.validateData(data, { origin: "https://leo-ljs.github.io" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.stats, { nodes: 2, folders: 1, files: 1, bytes: result.stats.bytes, maxDepth: 2 });
  assert.ok(result.stats.bytes > 0);
});

test("validateData 拒绝错误的 schema 与类型", () => {
  const data = baseData([]);
  data.schemaVersion = 2;
  data.type = "other";
  const result = PanData.validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.path === "$.schemaVersion"));
  assert.ok(result.errors.some((item) => item.path === "$.type"));
});

test("validateData 拒绝重复 id 与空名称", () => {
  const data = baseData([
    file("same", "a.txt", "https://example.com/a"),
    file("same", " ", "https://example.com/b")
  ]);
  const result = PanData.validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.message.includes("id 重复")));
  assert.ok(result.errors.some((item) => item.message.includes("名称不能为空")));
});

test("URL 必须是 http(s) 且不能指向本站", () => {
  assert.equal(PanData.checkExternalUrl("ftp://example.com/a").ok, false);
  assert.equal(PanData.checkExternalUrl("javascript:alert(1)").ok, false);
  assert.equal(PanData.checkExternalUrl("/local/file.zip").ok, false);
  assert.equal(
    PanData.checkExternalUrl("https://leo-ljs.github.io/pan/data.json", {
      origin: "https://leo-ljs.github.io"
    }).ok,
    false
  );
  assert.equal(
    PanData.checkExternalUrl("https://leo-ljs.github.io/pan/data.json", {
      siteHosts: ["leo-ljs.github.io"]
    }).ok,
    false
  );
  const good = PanData.checkExternalUrl("https://wwi.lanzoup.com/abc", {
    origin: "https://leo-ljs.github.io"
  });
  assert.equal(good.ok, true);
  assert.equal(good.url, "https://wwi.lanzoup.com/abc");
});

test("validateData 报告 URL 错误", () => {
  const data = baseData([file("f1", "a.txt", "https://leo-ljs.github.io/file")]);
  const result = PanData.validateData(data, { origin: "https://leo-ljs.github.io" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.path.endsWith(".url")));
});

test("validateData 限制目录深度 20 层", () => {
  let node = { id: "leaf", type: "file", name: "leaf.txt", url: "https://example.com/x" };
  for (let i = 21; i >= 1; i -= 1) {
    node = { id: "d" + i, type: "folder", name: "层" + i, children: [node] };
  }
  const result = PanData.validateData(baseData([node]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.message.includes("层级")));
});

test("validateData 限制 30000 个节点", () => {
  const tree = [];
  for (let i = 0; i < 30001; i += 1) {
    tree.push(file("f" + i, "f" + i + ".txt", "https://example.com/" + i));
  }
  const result = PanData.validateData(baseData(tree));
  assert.equal(result.ok, false);
  assert.equal(result.stats.nodes, 30001);
  assert.ok(result.errors.some((item) => item.message.includes("30000")));
});

test("parseJson 拒绝坏 JSON 和危险键", () => {
  assert.equal(PanData.parseJson("{ nope").ok, false);
  const text = JSON.stringify(baseData([])).replace(
    '"tree":[]',
    '"tree":[],"__proto__":{"polluted":true}'
  );
  const result = PanData.parseJson(text);
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data, "__proto__"), false);
  assert.equal({}.polluted, undefined);
});

test("parseJson 返回可读的第一条错误", () => {
  const data = baseData([file("f1", "a.txt", "ftp://example.com/a")]);
  const result = PanData.parseJson(JSON.stringify(data));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("url"));
});

test("sanitizeData 去掉原型污染键", () => {
  const raw = JSON.parse('{"a":{"__proto__":{"x":1},"b":2},"constructor":3}');
  const clean = PanData.sanitizeData(raw);
  assert.deepEqual(clean, { a: { b: 2 } });
  assert.equal({}.x, undefined);
});

test("日期校验严格对待 2 月 29 日", () => {
  assert.equal(PanData.isValidDateString("2024-02-29"), true);
  assert.equal(PanData.isValidDateString("2026-02-29"), false);
  assert.equal(PanData.isValidDateString("2026-13-01"), false);
  assert.equal(PanData.isValidDateString("2026-1-1"), false);
  assert.equal(PanData.isValidDateString("2026-11-13T08:30:00+08:00"), true);
});

test("makeId 稳定、区分文件夹，并能处理碰撞", () => {
  const a = PanData.makeId("资料/笔记.pdf", false);
  const b = PanData.makeId("资料/笔记.pdf", false);
  const c = PanData.makeId("资料/笔记.pdf", true);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^n_[0-9a-f]{8}$/);
  const used = Object.create(null);
  const first = PanData.makeId("same", false, used);
  const second = PanData.makeId("same", false, used);
  assert.equal(second, first + "-2");
});

test("findNode 返回父节点与完整路径", () => {
  const data = baseData([
    {
      id: "d1",
      type: "folder",
      name: "A",
      children: [
        { id: "d2", type: "folder", name: "B", children: [file("f1", "c.txt", "https://example.com/c")] }
      ]
    }
  ]);
  const found = PanData.findNode(data.tree, "f1");
  assert.equal(found.node.name, "c.txt");
  assert.equal(found.parent.id, "d2");
  assert.deepEqual(found.path.map((node) => node.name), ["A", "B", "c.txt"]);
  assert.equal(PanData.findNode(data.tree, "missing"), null);
});

test("searchTree 搜索名称和描述并限制数量", () => {
  const data = baseData([
    {
      id: "d1",
      type: "folder",
      name: "学习",
      children: [
        file("f1", "网络笔记.pdf", "https://example.com/1", { description: "TCP/IP" }),
        file("f2", "数学.pdf", "https://example.com/2", { description: "线代" })
      ]
    }
  ]);
  assert.equal(PanData.searchTree(data.tree, "网络").length, 1);
  assert.equal(PanData.searchTree(data.tree, "tcp").length, 1);
  assert.equal(PanData.searchTree(data.tree, "pdf").length, 2);
  assert.equal(PanData.searchTree(data.tree, "pdf", 1).length, 1);
  assert.equal(PanData.searchTree(data.tree, "").length, 0);
});

test("sortNodes 文件夹优先并按名称排序", () => {
  const nodes = [
    file("f1", "b.txt", "https://example.com/b"),
    { id: "d1", type: "folder", name: "z", children: [] },
    file("f2", "a.txt", "https://example.com/a")
  ];
  const sorted = PanData.sortNodes(nodes, "name", "asc");
  assert.deepEqual(sorted.map((node) => node.name), ["z", "a.txt", "b.txt"]);
});

test("formatSize 与 formatDate", () => {
  assert.equal(PanData.formatSize(0), "0 B");
  assert.equal(PanData.formatSize(1536), "1.5 KB");
  assert.equal(PanData.formatSize(1024 * 1024), "1.0 MB");
  assert.equal(PanData.formatSize(null), "—");
  assert.equal(PanData.formatDate("2026-11-13T10:00:00"), "2026-11-13");
  assert.equal(PanData.formatDate("nope"), "—");
});

test("mergeChildren 保留已填链接与说明，更新扫描信息", () => {
  const existing = [
    {
      id: "old-folder",
      type: "folder",
      name: "资料",
      description: "保留我",
      children: [
        file("old-file", "a.txt", "https://example.com/a", {
          code: "abcd",
          description: "旧说明",
          size: 1
        })
      ]
    }
  ];
  const incoming = [
    {
      id: "new-folder",
      type: "folder",
      name: "资料",
      description: "",
      children: [
        Object.assign(file("new-file", "a.txt", "", { size: 2048 }), {
          code: "",
          description: "",
          updatedAt: "2026-11-13"
        }),
        file("new-b", "b.txt", "", { size: 3 })
      ]
    }
  ];
  const merged = PanData.mergeChildren(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "old-folder");
  assert.equal(merged[0].children[0].id, "old-file");
  assert.equal(merged[0].children[0].url, "https://example.com/a");
  assert.equal(merged[0].children[0].code, "abcd");
  assert.equal(merged[0].children[0].description, "旧说明");
  assert.equal(merged[0].children[0].size, 2048);
  assert.equal(merged[0].children[0].updatedAt, "2026-11-13");
  assert.equal(merged[0].children[1].name, "b.txt");
});

test("collectIds 与 ensureUniqueIds 处理扫描合并的 ID 冲突", () => {
  const existing = [
    { id: "n_same", type: "file", name: "a.txt", url: "https://example.com/a" }
  ];
  const reserved = PanData.collectIds(existing);
  assert.equal(reserved.n_same, true);

  const incoming = [
    {
      id: "n_same",
      type: "folder",
      name: "资料",
      children: [
        { id: "n_same", type: "file", name: "a.txt", url: "" }
      ]
    },
    { id: "n_same", type: "file", name: "b.txt", url: "" }
  ];
  PanData.ensureUniqueIds(incoming, reserved);
  const ids = [];
  function walk(nodes) {
    nodes.forEach((node) => {
      ids.push(node.id);
      if (node.type === "folder") walk(node.children);
    });
  }
  walk(incoming);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("n_same"));
  assert.equal(reserved.n_same, true);
});

test("ensureUniqueIds 为空白 ID 生成唯一 ID", () => {
  const tree = [
    { id: "", type: "folder", name: "资料", children: [{ id: "", type: "file", name: "a.txt" }] }
  ];
  PanData.ensureUniqueIds(tree);
  const ids = [tree[0].id, tree[0].children[0].id];
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(new Set(ids).size, 2);
});

test("uniqueName 处理重名", () => {
  const children = [{ name: "新建文件夹" }, { name: "新建文件夹 (2)" }];
  assert.equal(PanData.uniqueName(children, "新建文件夹"), "新建文件夹 (3)");
  assert.equal(PanData.uniqueName([], "  "), "未命名");
});
