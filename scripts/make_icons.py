#!/usr/bin/env python3
"""拡張機能アイコン生成スクリプト。GitHubダーク背景にフォルダ + ライブインジケータ。"""
import os
import struct
import zlib

BG = (36, 41, 47)        # GitHub dark
FOLDER = (255, 255, 255)  # white folder
DOT = (63, 185, 80)       # green "live" dot


def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2 or (
        x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r
    )


def draw(x, y, size):
    fx, fy = (x + 0.5) / size, (y + 0.5) / size
    # 背景: 角丸スクエア
    r = 0.18
    if not in_rounded_rect(fx, fy, 0.02, 0.02, 0.98, 0.98, r):
        return (0, 0, 0, 0)

    color = BG
    # フォルダのタブ部分
    if 0.20 <= fx <= 0.48 and 0.28 <= fy <= 0.40:
        color = FOLDER
    # フォルダの本体
    if 0.20 <= fx <= 0.80 and 0.38 <= fy <= 0.72:
        color = FOLDER
    # ライブインジケータ（緑の丸、白フチ）
    dx, dy = fx - 0.72, fy - 0.68
    d2 = dx * dx + dy * dy
    if d2 <= 0.15 ** 2:
        color = BG  # フチ（背景色で抜く）
    if d2 <= 0.11 ** 2:
        color = DOT
    return (*color, 255)


def make_png(size):
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter: none
        for x in range(size):
            row += bytes(draw(x, y, size))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "src", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(make_png(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
