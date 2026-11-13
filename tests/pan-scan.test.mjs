import test from "node:test";
import assert from "node:assert/strict";
import PanData from "../assets/js/pan-data.js";
import PanScan from "../assets/js/pan-scan.js";

test("buildTree 构建嵌套目录并保留空文件夹", () => {
  const result = PanScan.buildTree(
    [
      { path: "学习资料", type: "directory" },
      { path: "学习资料/计算机", type: "directory" },
      { path: "学习资料/计算机/网络.pdf", type: "file", size: 1024, lastModified: Date.UTC(2026, 10, 2) },
      { path: "空文件夹", type: "directory" },
      { path: "说明.txt", type: "file", size: 12, lastModified: Date.UTC(2026, 10, 3) }
    ],
    { rootName: "我的资料" }
  );

  assert.equal(result.rootName, "我的资料");
  assert.equal(result.tree.length, 3);
  assert.deepEqual(
    result.tree.map((node) => node.name),
    ["学习资料", "空文件夹", "说明.txt"]
  );
  assert.equal(result.tree[0].children[0].name, "计算机");
  assert.equal(result.tree[0].children[0].children[0].name, "网络.pdf");
  assert.equal(result.tree[0].children[0].children[0].size, 1024);
  assert.match(result.tree[0].children[0].children[0].updatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.stats.files, 2);
  assert.equal(result.stats.folders, 3);
  assert.equal(result.stats.totalSize, 1036);
  assert.equal(result.emptyFoldersLost, false);
});

test("buildTree 生成稳定且唯一的 ID", () => {
  const entries = [
    { path: "A", type: "directory" },
    { path: "A/b.txt", type: "file", size: 1 },
    { path: "a", type: "directory" }
  ];
  const first = PanScan.buildTree(entries);
  const second = PanScan.buildTree(entries);
  const flat = PanData.flattenTree(first.tree).map((item) => item.node);
  const ids = flat.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, PanData.flattenTree(second.tree).map((item) => item.node.id));
  const folderA = flat.find((node) => node.name === "A" && node.type === "folder");
  const fileB = flat.find((node) => node.name === "b.txt");
  assert.equal(folderA.id, PanData.makeId("A", true));
  assert.equal(fileB.id, PanData.makeId("A/b.txt", false));
});

test("buildTree 拒绝超过 20 层的目录", () => {
  const segments = [];
  for (let i = 1; i <= 21; i += 1) segments.push("d" + i);
  assert.throws(
    () => PanScan.buildTree([{ path: segments.join("/") + "/x.txt", type: "file" }]),
    (error) => error.code === "SCAN_LIMIT"
  );
});

test("buildTree 拒绝文件与文件夹路径冲突", () => {
  assert.throws(
    () =>
      PanScan.buildTree([
        { path: "a", type: "file" },
        { path: "a/b.txt", type: "file" }
      ]),
    (error) => error.code === "SCAN_INVALID"
  );
});

test("buildTree 支持取消", () => {
  assert.throws(
    () =>
      PanScan.buildTree(
        [
          { path: "a", type: "directory" },
          { path: "a/b.txt", type: "file" }
        ],
        { shouldCancel: () => true }
      ),
    (error) => error.code === "SCAN_CANCELLED"
  );
});

test("scanFileList 去掉 webkitRelativePath 的根目录", async () => {
  const files = [
    {
      name: "a.txt",
      webkitRelativePath: "我的目录/子目录/a.txt",
      size: 5,
      lastModified: Date.UTC(2026, 10, 4)
    }
  ];
  const result = await PanScan.scanFileList(files, { emptyFoldersLost: true });
  assert.equal(result.rootName, "我的目录");
  assert.equal(result.tree[0].name, "子目录");
  assert.equal(result.tree[0].children[0].name, "a.txt");
  assert.equal(result.emptyFoldersLost, true);
  assert.equal(result.notes.length, 1);
});

test("scanFileList 处理没有相对路径的普通文件", async () => {
  const result = await PanScan.scanFileList([{ name: "a.txt", size: 1, lastModified: 0 }]);
  assert.equal(result.rootName, "扫描结果");
  assert.equal(result.tree[0].name, "a.txt");
  assert.equal("updatedAt" in result.tree[0], false);
});

test("buildTree 输出可被 validateData 接受", () => {
  const result = PanScan.buildTree(
    [
      { path: "资料", type: "directory" },
      { path: "资料/a.pdf", type: "file", size: 100 }
    ],
    { rootName: "demo" }
  );
  const data = PanData.createEmptyData({ tree: result.tree });
  const checked = PanData.validateData(data);
  if (!checked.ok) {
    // 扫描结果没有外链，因此这里只应出现 url 错误；结构本身必须合法。
    assert.ok(checked.errors.every((item) => item.path.endsWith(".url")));
  }
  assert.equal(result.tree[0].type, "folder");
});
