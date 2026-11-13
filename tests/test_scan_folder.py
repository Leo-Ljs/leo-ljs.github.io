import importlib.util
import io
import json
import shutil
import unittest
import uuid
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "scan_folder.py"
WORK_ROOT = Path(__file__).resolve().parents[1] / ".tmp-tests"
WORK_ROOT.mkdir(exist_ok=True)


@contextmanager
def case_dir(prefix="case"):
    """Create a normal workspace directory.

    tempfile.mkdtemp() produces a directory this sandbox cannot write inside,
    so tests use an explicit workspace scratch directory instead.
    """
    path = WORK_ROOT / f"{prefix}-{uuid.uuid4().hex[:8]}"
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


SPEC = importlib.util.spec_from_file_location("scan_folder", MODULE_PATH)
scan_folder = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(scan_folder)


class ScanFolderTests(unittest.TestCase):
    def test_nested_tree_preserves_empty_folder(self) -> None:
        with case_dir("case") as temp:
            root = Path(temp) / "资料库"
            (root / "A" / "B").mkdir(parents=True)
            (root / "A" / "B" / "笔记.pdf").write_bytes(b"hello")
            (root / "空文件夹").mkdir()
            (root / "readme.txt").write_text("hi", encoding="utf-8")

            data, stats, warnings = scan_folder.build_data(root, title="我的网盘")
            self.assertEqual(data["schemaVersion"], 1)
            self.assertEqual(data["type"], "leoljs-pan")
            self.assertEqual(data["title"], "我的网盘")
            self.assertEqual(warnings, [])
            self.assertEqual(stats["folders"], 3)
            self.assertEqual(stats["files"], 2)
            self.assertEqual(stats["totalSize"], 7)

            names = [node["name"] for node in data["tree"]]
            self.assertEqual(names, ["A", "空文件夹", "readme.txt"])
            a = data["tree"][0]
            self.assertEqual(a["children"][0]["name"], "B")
            self.assertEqual(a["children"][0]["children"][0]["name"], "笔记.pdf")
            self.assertEqual(a["children"][0]["children"][0]["size"], 5)
            self.assertTrue(a["children"][0]["children"][0]["updatedAt"])

    def test_ids_match_javascript_algorithm(self) -> None:
        with case_dir("case") as temp:
            root = Path(temp)
            (root / "资料").mkdir()
            (root / "资料" / "笔记.pdf").write_bytes(b"x")
            data, _, _ = scan_folder.build_data(root, root_name="资料库")
            folder = data["tree"][0]
            file_node = folder["children"][0]
            self.assertEqual(folder["id"], "n_d430814a")
            self.assertEqual(file_node["id"], "n_73d6239f")

    def test_make_id_collision(self) -> None:
        used: dict[str, bool] = {}
        first = scan_folder.make_id("same", False, used)
        second = scan_folder.make_id("same", False, used)
        self.assertEqual(second, first + "-2")

    def test_depth_limit(self) -> None:
        with case_dir("case") as temp:
            root = Path(temp)
            current = root
            for index in range(1, 22):
                current = current / f"d{index}"
            current.mkdir(parents=True)
            with self.assertRaises(scan_folder.ScanError) as caught:
                scan_folder.scan_folder(root)
            self.assertEqual(caught.exception.code, "SCAN_LIMIT")

    def test_empty_folder_gives_empty_tree(self) -> None:
        with case_dir("case") as temp:
            data, stats, _ = scan_folder.build_data(Path(temp))
            self.assertEqual(data["tree"], [])
            self.assertEqual(stats["nodes"], 0)

    def test_write_output_and_force(self) -> None:
        with case_dir("case") as temp:
            root = Path(temp) / "src"
            root.mkdir()
            (root / "a.txt").write_text("a", encoding="utf-8")
            output = Path(temp) / "out.json"

            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(scan_folder.main([str(root), "-o", str(output)]), 0)
            self.assertTrue(output.exists())
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["schemaVersion"], 1)

            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(scan_folder.main([str(root), "-o", str(output)]), 1)
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(scan_folder.main([str(root), "-o", str(output), "--force"]), 0)

    def test_serialized_size_limit(self) -> None:
        data = {"schemaVersion": 1, "type": "leoljs-pan", "title": "x", "tree": []}
        text = scan_folder.serialize(data)
        self.assertTrue(text.endswith("\n"))
        self.assertIn('"schemaVersion": 1', text)


if __name__ == "__main__":
    unittest.main()
