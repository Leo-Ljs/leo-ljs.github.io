#!/usr/bin/env python3
"""把本地文件夹扫描成网盘可用的 data.json。

只读取文件名、大小和修改时间，不读取文件内容，不上传任何东西。
用法：
    python tools/scan_folder.py "D:\\资料" 
    python tools/scan_folder.py "D:\\资料" -o pan/data.json --title "我的网盘"
    python tools/scan_folder.py "D:\\资料" --root-name "资料库" --force

也可以直接把文件夹拖到 scan_folder.bat 上。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
TYPE = "leoljs-pan"
MAX_NODES = 30000
MAX_BYTES = 10 * 1024 * 1024
MAX_DEPTH = 20


class ScanError(Exception):
    """扫描或输出失败；code 供测试与调用方判断。"""

    def __init__(self, message: str, code: str = "SCAN_ERROR") -> None:
        super().__init__(message)
        self.code = code


def fnv1a(text: str) -> str:
    """32 位 FNV-1a，输入按 UTF-8 编码；与 assets/js/pan-data.js 保持一致。"""
    value = 0x811C9DC5
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}"


def make_id(relative_path: str, is_folder: bool, used: dict[str, bool] | None = None) -> str:
    """由相对路径生成稳定 ID；文件夹路径额外带一个斜杠。"""
    key = str(relative_path or "").replace("\\", "/").strip("/")
    if is_folder:
        key += "/"
    base = "n_" + fnv1a(key)
    if used is None:
        return base
    candidate = base
    attempt = 2
    while candidate in used:
        candidate = f"{base}-{attempt}"
        attempt += 1
    used[candidate] = True
    return candidate


def _mtime_date(timestamp: float) -> str:
    if not timestamp or timestamp <= 0:
        return ""
    try:
        return datetime.fromtimestamp(timestamp).date().isoformat()
    except (OSError, OverflowError, ValueError):
        return ""


def _sort_key(entry: os.DirEntry[str]) -> tuple[int, str]:
    try:
        is_folder = entry.is_dir(follow_symlinks=False)
    except OSError:
        is_folder = False
    return (0 if is_folder else 1, entry.name)


def scan_folder(
    root: Path | str,
    root_name: str | None = None,
    max_nodes: int = MAX_NODES,
    max_depth: int = MAX_DEPTH,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
    """扫描目录，返回 (tree, stats, warnings)。root 本身不会出现在 tree 中。"""
    root_path = Path(root)
    if not root_path.exists():
        raise ScanError(f"文件夹不存在：{root_path}", "SCAN_NOT_FOUND")
    if not root_path.is_dir():
        raise ScanError(f"不是一个文件夹：{root_path}", "SCAN_NOT_DIR")

    stats: dict[str, Any] = {
        "nodes": 0,
        "folders": 0,
        "files": 0,
        "totalSize": 0,
        "maxDepth": 0,
    }
    warnings: list[str] = []
    used_ids: dict[str, bool] = {}

    def walk(directory: Path, relative_prefix: str, depth: int) -> list[dict[str, Any]]:
        try:
            with os.scandir(directory) as iterator:
                entries = sorted(iterator, key=_sort_key)
        except OSError as error:
            warnings.append(f"无法读取文件夹：{directory}（{error.strerror or error}）")
            return []

        children: list[dict[str, Any]] = []
        for entry in entries:
            if entry.is_symlink():
                warnings.append(f"已跳过符号链接：{entry.path}")
                continue

            try:
                is_folder = entry.is_dir(follow_symlinks=False)
                is_file = entry.is_file(follow_symlinks=False)
            except OSError as error:
                warnings.append(f"无法读取：{entry.path}（{error.strerror or error}）")
                continue
            if not is_folder and not is_file:
                warnings.append(f"已跳过特殊文件：{entry.path}")
                continue

            child_depth = depth + 1
            if child_depth > max_depth:
                raise ScanError(f"目录层级超过 {max_depth} 层：{entry.path}", "SCAN_LIMIT")
            relative = f"{relative_prefix}/{entry.name}" if relative_prefix else entry.name

            if is_folder:
                node: dict[str, Any] = {
                    "id": "",
                    "type": "folder",
                    "name": entry.name,
                    "description": "",
                    "children": walk(Path(entry.path), relative, child_depth),
                }
                stats["folders"] += 1
            else:
                try:
                    info = entry.stat(follow_symlinks=False)
                except OSError as error:
                    warnings.append(f"无法读取：{entry.path}（{error.strerror or error}）")
                    continue
                node = {
                    "id": "",
                    "type": "file",
                    "name": entry.name,
                    "url": "",
                    "code": "",
                    "size": int(info.st_size),
                    "description": "",
                }
                updated = _mtime_date(info.st_mtime)
                if updated:
                    node["updatedAt"] = updated
                stats["files"] += 1
                stats["totalSize"] += int(info.st_size)

            children.append(node)
            stats["nodes"] += 1
            stats["maxDepth"] = max(stats["maxDepth"], child_depth)
            if stats["nodes"] > max_nodes:
                raise ScanError(f"文件数量超过 {max_nodes} 个。", "SCAN_LIMIT")
        return children

    tree = walk(root_path, "", 0)

    def assign_ids(nodes: list[dict[str, Any]], prefix: str) -> None:
        for node in nodes:
            relative = f"{prefix}/{node['name']}" if prefix else node["name"]
            node["id"] = make_id(relative, node["type"] == "folder", used_ids)
            if node["type"] == "folder":
                assign_ids(node["children"], relative)

    assign_ids(tree, "")
    return tree, stats, warnings


def build_data(
    root: Path | str,
    title: str | None = None,
    root_name: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    root_path = Path(root)
    resolved_name = (root_name or root_path.resolve().name or "扫描结果").strip() or "扫描结果"
    tree, stats, warnings = scan_folder(root_path, root_name=resolved_name)
    data = {
        "schemaVersion": SCHEMA_VERSION,
        "type": TYPE,
        "title": (title or resolved_name).strip() or resolved_name,
        "notice": "由 scan_folder.py 扫描生成，请在可视化编辑器里补充下载链接、提取码和说明。",
        "updatedAt": date.today().isoformat(),
        "tree": tree,
    }
    return data, stats, warnings


def serialize(data: dict[str, Any]) -> str:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        raise ScanError(
            f"生成的 JSON 为 {size / 1024 / 1024:.2f} MB，超过 {MAX_BYTES // 1024 // 1024} MB 限制。",
            "SCAN_LIMIT",
        )
    return text


def default_output_path(root: Path) -> Path:
    base = root.parent / (root.name + ".pan.json")
    if not base.exists():
        return base
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = root.parent / f"{root.name}.pan-{stamp}.json"
    attempt = 2
    while candidate.exists():
        candidate = root.parent / f"{root.name}.pan-{stamp}-{attempt}.json"
        attempt += 1
    return candidate


def write_output(text: str, output: Path, force: bool = False) -> None:
    if output.exists() and not force:
        raise ScanError(f"输出文件已存在：{output}\n如需覆盖，请加 --force。", "SCAN_EXISTS")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="把一个文件夹扫描成 Leo 网盘使用的 JSON（只读名称、大小、时间）。"
    )
    parser.add_argument("folder", help="要扫描的文件夹")
    parser.add_argument("-o", "--output", help="输出 JSON 路径；默认放在文件夹旁边")
    parser.add_argument("--title", help="网盘标题，默认使用文件夹名")
    parser.add_argument("--root-name", help="扫描根目录名称，默认使用文件夹名")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的输出文件")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path(args.folder).expanduser()
    try:
        data, stats, warnings = build_data(root, title=args.title, root_name=args.root_name)
        text = serialize(data)
        output = Path(args.output).expanduser() if args.output else default_output_path(root.resolve())
        write_output(text, output, force=args.force)
    except ScanError as error:
        print(f"扫描失败：{error}", file=sys.stderr)
        return 2 if error.code == "SCAN_LIMIT" else 1
    except KeyboardInterrupt:
        print("已取消。", file=sys.stderr)
        return 130

    for warning in warnings:
        print(f"提示：{warning}", file=sys.stderr)
    print(f"已生成：{output}")
    print(
        f"共 {stats['nodes']} 个节点（{stats['folders']} 个文件夹，"
        f"{stats['files']} 个文件），总大小 {stats['totalSize'] / 1024 / 1024:.2f} MB。"
    )
    print("下一步：用编辑器补齐每个文件的外链，导出后再上传到 GitHub。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
