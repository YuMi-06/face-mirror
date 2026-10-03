"""生成一份带运动的人脸 y4m 测试视频（喂给 Chromium 的假摄像头）。
素材是 MediaPipe 官方测试肖像 portrait.jpg（真人脸，非个人信息）。
用法: python _tools/make_test_video.py
"""
import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / 'face_test.y4m'
SRC = HERE / 'portrait.jpg'
URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg'
W, H, FPS, FRAMES = 480, 360, 30, 96


def fetch_source() -> Image.Image:
    if not SRC.exists():
        print('下载测试肖像 ...')
        req = urllib.request.Request(URL, headers={'User-Agent': 'dsh'})
        with urllib.request.urlopen(req, timeout=60) as r:
            SRC.write_bytes(r.read())
    img = Image.open(SRC).convert('RGB')
    print('素材尺寸', img.size)
    # 人脸在这些图里的位置是实测出来的（见 probe_metrics.mjs）：
    #   bbox x 0.375–0.609, y 0.099–0.341 → 脸心 (0.492, 0.220)，脸高 0.242*H
    # 按脸心开一个 640x480 的取景窗（稍微往下偏一点，给头顶留余量），
    # 这样脸占画面高度约 52%，接近真人坐在摄像头前的比例。
    fcx, fcy = 0.492 * img.width, 0.220 * img.height + 40
    tw, th = 640, 480
    left = int(min(max(0, fcx - tw / 2), img.width - tw))
    top = int(min(max(0, fcy - th / 2), img.height - th))
    return img.crop((left, top, left + tw, top + th))


def to_i420(arr: np.ndarray) -> bytes:
    """RGB uint8 (H,W,3) → I420 平面（BT.601）"""
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = -0.169 * r - 0.331 * g + 0.5 * b + 128.0
    v = 0.5 * r - 0.419 * g - 0.081 * b + 128.0
    y = np.clip(y, 0, 255).astype(np.uint8)
    u = np.clip(u, 0, 255).astype(np.uint8)
    v = np.clip(v, 0, 255).astype(np.uint8)
    # 2x2 平均降采样
    u2 = u.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    v2 = v.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    return y.tobytes() + u2.tobytes() + v2.tobytes()


def main() -> int:
    base = fetch_source()
    buf = io.BytesIO()
    buf.write(b'YUV4MPEG2 W%d H%d F%d:1 Ip A1:1 C420mpeg2\n' % (W, H, FPS))
    for i in range(FRAMES):
        t = i / FRAMES
        zoom = 1.0 + 0.09 * math.sin(2 * math.pi * t)
        cx = base.width / 2 + 52 * math.sin(2 * math.pi * t)
        cy = base.height / 2 + 26 * math.sin(4 * math.pi * t)
        cw = base.width / zoom
        ch = base.height / zoom
        box = (
            max(0, min(base.width - cw, cx - cw / 2)),
            max(0, min(base.height - ch, cy - ch / 2)),
        )
        frame = base.crop((round(box[0]), round(box[1]), round(box[0] + cw), round(box[1] + ch))).resize((W, H), Image.BILINEAR)
        buf.write(b'FRAME\n')
        buf.write(to_i420(np.asarray(frame)))
    OUT.write_bytes(buf.getvalue())
    print('写出', OUT, round(OUT.stat().st_size / 1048576, 2), 'MB', FRAMES, '帧')
    print(json.dumps({'file': str(OUT), 'w': W, 'h': H, 'fps': FPS, 'frames': FRAMES}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
