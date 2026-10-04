"""生成"两个人并排"的 y4m 测试视频（喂给 Chromium 的假摄像头），用来核对多人同框。
素材用 MediaPipe 官方测试肖像 portrait.jpg（真人脸，非个人信息；本机临时用，不进仓库）。
用法: python _tools/make_two_face_video.py
"""
import io
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / 'face_two.y4m'
SRC = HERE / 'portrait.jpg'  # 与 make_test_video.py 共用（不存在时后者会下载）
W, H, FPS, FRAMES = 640, 480, 30, 96


def to_i420(arr: np.ndarray) -> bytes:
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    y = np.clip(0.299 * r + 0.587 * g + 0.114 * b, 0, 255).astype(np.uint8)
    u = np.clip(-0.169 * r - 0.331 * g + 0.5 * b + 128.0, 0, 255).astype(np.uint8)
    v = np.clip(0.5 * r - 0.419 * g - 0.081 * b + 128.0, 0, 255).astype(np.uint8)
    u2 = u.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    v2 = v.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    return y.tobytes() + u2.tobytes() + v2.tobytes()


def face_crop() -> Image.Image:
    img = Image.open(SRC).convert('RGB')
    # 与 make_test_video.py 相同的取景（实测人脸 bbox 中心 0.492/0.220）
    fcx, fcy = 0.492 * img.width, 0.220 * img.height + 40
    tw, th = 640, 480
    left = int(min(max(0, fcx - tw / 2), img.width - tw))
    top = int(min(max(0, fcy - th / 2), img.height - th))
    return img.crop((left, top, left + tw, top + th))


def main() -> int:
    if not SRC.exists():
        print('缺少 portrait.jpg：先跑一次 python _tools/make_test_video.py（它会下载素材）')
        return 1
    base = face_crop()
    # 两个人各占一半：左边那位稍微偏一点、右边那位稍微不同，便于看出是两张脸
    half = (W // 2, H)
    a = base.resize(half, Image.LANCZOS)
    b = base.transpose(Image.FLIP_LEFT_RIGHT).resize(half, Image.LANCZOS)
    canvas0 = Image.new('RGB', (W, H), (26, 26, 34))
    canvas0.paste(a, (0, 0))
    canvas0.paste(b, (W // 2, 0))

    buf = io.BytesIO()
    buf.write(b'YUV4MPEG2 W%d H%d F%d:1 Ip A1:1 C420mpeg2\n' % (W, H, FPS))
    for i in range(FRAMES):
        t = i / FRAMES
        s = 1.0 + 0.04 * math.sin(2 * math.pi * t)
        cw, ch = int(W / s), int(H / s)
        box = (int((W - cw) / 2 + 8 * math.sin(2 * math.pi * t)), int((H - ch) / 2))
        frame = canvas0.crop((box[0], box[1], box[0] + cw, box[1] + ch)).resize((W, H), Image.BILINEAR)
        buf.write(b'FRAME\n')
        buf.write(to_i420(np.asarray(frame)))
    OUT.write_bytes(buf.getvalue())
    print('写出', OUT, round(OUT.stat().st_size / 1048576, 2), 'MB', FRAMES, '帧')
    return 0


if __name__ == '__main__':
    sys.exit(main())
