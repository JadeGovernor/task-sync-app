#!/usr/bin/env python3
"""生成 PWA 图标：纯标准库 PNG 编码，无需第三方依赖。
用法：python3 scripts/gen_icons.py [size...]  默认 192/512/180(apple-touch-icon)"""
import math
import os
import struct
import sys
import zlib


def png_bytes(w, h, rgba_rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    raw = b"".join(b"\x00" + bytes(row) for row in rgba_rows)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def make_icon(size):
    r = 0.19 * size  # 圆角半径
    segs = [((0.30, 0.53), (0.44, 0.67)), ((0.44, 0.67), (0.72, 0.34))]
    w_half = 0.082 * size
    grad_a = (99, 102, 241)   # #6366F1
    grad_b = (34, 211, 238)   # #22D3EE
    white = (255, 255, 255)

    def rect_cov(x, y):
        # 圆角矩形有符号距离(uv 空间放大到像素)
        qx = abs(x - size / 2) - (size / 2 - r)
        qy = abs(y - size / 2) - (size / 2 - r)
        ox, oy = max(qx, 0.0), max(qy, 0.0)
        d = min(max(qx, qy), 0.0) + math.hypot(ox, oy) - r
        return min(1.0, max(0.0, 0.5 - d))

    def seg_dist(px, py):
        best = 1e9
        for (x1, y1), (x2, y2) in segs:
            x1s, y1s, x2s, y2s = x1 * size, y1 * size, x2 * size, y2 * size
            vx, vy = x2s - x1s, y2s - y1s
            wx, wy = px - x1s, py - y1s
            t = max(0.0, min(1.0, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
            dx, dy = px - (x1s + t * vx), py - (y1s + t * vy)
            best = min(best, math.hypot(dx, dy))
        return best

    rows = []
    ss = 3  # 超采样
    for py in range(size):
        row = bytearray()
        for px in range(size):
            cov_r = 0.0
            cov_c = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = px + (sx + 0.5) / ss
                    y = py + (sy + 0.5) / ss
                    cov_r += rect_cov(x, y)
                    d = seg_dist(x, y)
                    cov_c += min(1.0, max(0.0, w_half + 0.5 - d))
            cov_r /= ss * ss
            cov_c /= ss * ss
            if cov_r <= 0:
                row += b"\x00\x00\x00\x00"
                continue
            t = px / max(1, size - 1)
            base = tuple(int(a + (b - a) * t) for a, b in zip(grad_a, grad_b))
            cr = cov_r * cov_c
            pix = tuple(int(base[i] * (1 - cr) + white[i] * cr) for i in range(3))
            row += bytes((pix[0], pix[1], pix[2], int(255 * cov_r)))
        rows.append(row)
    return png_bytes(size, size, rows)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out_dir, exist_ok=True)
    jobs = {"192": "icon-192.png", "512": "icon-512.png", "180": "apple-touch-icon.png"}
    sizes = sys.argv[1:] or list(jobs)
    for s in sizes:
        name = jobs.get(s, "icon-%s.png" % s)
        path = os.path.join(out_dir, name)
        with open(path, "wb") as f:
            f.write(make_icon(int(s)))
        print("wrote", path)


if __name__ == "__main__":
    main()
