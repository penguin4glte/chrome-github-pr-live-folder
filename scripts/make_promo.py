#!/usr/bin/env python3
"""Chrome Web Store 用プロモ画像生成。依存ライブラリなし（make_icons.py と同方式）。

- promo_small_440x280.png : 小タイル
- promo_marquee_1400x560.png : マーキー
GitHub ダーク背景 + フォルダ + ライブインジケータ + テキスト。
"""
import os
import struct
import zlib

BG = (36, 41, 47)          # GitHub dark
PANEL = (22, 27, 34)        # darker panel
FOLDER = (255, 255, 255)    # white folder
DOT = (63, 185, 80)         # green "live" dot
TEXT = (230, 237, 243)      # near-white text
SUB = (139, 148, 158)       # muted text

# 5x7 ドットフォント（必要な文字のみ）
FONT = {
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'B': ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    'C': ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'F': ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    'G': ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    'I': ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'T': ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    'U': ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    'V': ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    'a': ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
    'b': ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
    'c': ["00000", "00000", "01111", "10000", "10000", "10000", "01111"],
    'd': ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
    'e': ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
    'g': ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
    'h': ["10000", "10000", "11110", "10001", "10001", "10001", "10001"],
    'i': ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
    'l': ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
    'm': ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
    'n': ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
    'q': ["00000", "00000", "01111", "10001", "01111", "00001", "00001"],
    'o': ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
    'p': ["00000", "00000", "11110", "10001", "11110", "10000", "10000"],
    'r': ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
    's': ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
    't': ["00100", "00100", "11111", "00100", "00100", "00100", "00011"],
    'u': ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
    'v': ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
    'y': ["00000", "00000", "10001", "10001", "01111", "00001", "11110"],
    ' ': ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def blend(dst, src, a):
    return tuple(int(dst[i] * (1 - a) + src[i] * a) for i in range(3))


def make_canvas(w, h):
    return [[BG for _ in range(w)] for _ in range(h)]


def draw_text(buf, text, ox, oy, scale, color):
    for ci, ch in enumerate(text):
        glyph = FONT.get(ch, FONT[' '])
        for gy, line in enumerate(glyph):
            for gx, bit in enumerate(line):
                if bit == '1':
                    for sy in range(scale):
                        for sx in range(scale):
                            px = ox + (ci * 6 + gx) * scale + sx
                            py = oy + gy * scale + sy
                            if 0 <= py < len(buf) and 0 <= px < len(buf[0]):
                                buf[py][px] = color


def draw_logo(buf, cx, cy, s):
    """中心 (cx,cy)、一辺 s の角丸ロゴを描く。"""
    x0, y0 = cx - s // 2, cy - s // 2
    for y in range(s):
        for x in range(s):
            fx, fy = (x + 0.5) / s, (y + 0.5) / s
            # 角丸パネル
            r = 0.18 * s
            px, py = x, y
            inside = True
            if (px < r and py < r and (px - r) ** 2 + (py - r) ** 2 > r * r):
                inside = False
            if (px > s - r and py < r and (px - (s - r)) ** 2 + (py - r) ** 2 > r * r):
                inside = False
            if (px < r and py > s - r and (px - r) ** 2 + (py - (s - r)) ** 2 > r * r):
                inside = False
            if (px > s - r and py > s - r and (px - (s - r)) ** 2 + (py - (s - r)) ** 2 > r * r):
                inside = False
            if not inside:
                continue
            color = PANEL
            if 0.20 <= fx <= 0.48 and 0.28 <= fy <= 0.40:
                color = FOLDER
            if 0.20 <= fx <= 0.80 and 0.38 <= fy <= 0.72:
                color = FOLDER
            dx, dy = fx - 0.72, fy - 0.68
            d2 = dx * dx + dy * dy
            if d2 <= 0.15 ** 2:
                color = PANEL
            if d2 <= 0.11 ** 2:
                color = DOT
            yy, xx = y0 + y, x0 + x
            if 0 <= yy < len(buf) and 0 <= xx < len(buf[0]):
                buf[yy][xx] = color


def write_png(path, buf):
    h, w = len(buf), len(buf[0])
    raw = bytearray()
    for row in buf:
        raw.append(0)
        for px in row:
            raw += bytes((px[0], px[1], px[2], 255))

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({w}x{h})")


def make_small(out_dir):
    w, h = 440, 280
    buf = make_canvas(w, h)
    draw_logo(buf, 100, 140, 140)
    draw_text(buf, "GitHub PR", 196, 100, 3, TEXT)
    draw_text(buf, "Live Folder", 196, 138, 3, TEXT)
    draw_text(buf, "PRs to tab groups", 196, 178, 2, SUB)
    write_png(os.path.join(out_dir, "promo_small_440x280.png"), buf)


def make_marquee(out_dir):
    w, h = 1400, 560
    buf = make_canvas(w, h)
    draw_logo(buf, 300, 280, 320)
    draw_text(buf, "GitHub PR", 560, 160, 8, TEXT)
    draw_text(buf, "Live Folder", 560, 260, 8, TEXT)
    draw_text(buf, "sync Pull Requests to Chrome tab groups", 560, 380, 3, SUB)
    write_png(os.path.join(out_dir, "promo_marquee_1400x560.png"), buf)


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "store-assets")
    os.makedirs(out_dir, exist_ok=True)
    make_small(out_dir)
    make_marquee(out_dir)


if __name__ == "__main__":
    main()
