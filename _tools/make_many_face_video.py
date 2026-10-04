"""生成"很多人脸"的 y4m 测试视频（喂给 Chromium 的假摄像头），用来核对 4 人以上的多人同框。
素材用 MediaPipe 官方测试肖像 portrait.jpg（真人脸，非个人信息；本机临时用，不进仓库）。
用法: python _tools/make_many_face_video.py [人数] [列数]
      python _tools/make_many_face_video.py 6 3     # 3 列 2 行 = 6 张脸
"""
import io
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / 'face_many.y4m'
SRC = HERE / 'portrait.jpg'  # 与 make_test_video.py 共用（不存在时后者会下载）

W, H, FPS, FRAMES = 960, 540, 30, 60


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
    fcx, fcy = 0.492 * img.width, 0.220 * img.height + 40
    tw, th = 640, 480
    left = int(min(max(0, fcx - tw / 2), img.width - tw))
    top = int(min(max(0, fcy - th / 2), img.height - th))
    return img.crop((left, top, left + tw, top + th))


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    if not SRC.exists():
        print('缺少 portrait.jpg：先跑一次 python _tools/make_test_video.py（它会下载素材）')
        return 1
    rows = int(math.ceil(n / cols))
    cw, ch = W // cols, H // rows
    # 每人一张略作区别的脸（交替镜像），便于确认"每个人是独立的一套五官"
    base = face_crop()
    variants = [base, base.transpose(Image.FLIP_LEFT_RIGHT)]
    cells = [v.resize((cw, int(cw * 0.75)), Image.LANCZOS) for v in variants]
    canvas0 = Image.new('RGB', (W, H), (24, 24, 32))
    for i in range(n):
        c = cells[i % 2]
        x = (i % cols) * cw + (cw - c.width) // 2
        y = (i // cols) * ch + (ch - c.height) // 2
        canvas0.paste(c, (x, y))

    buf = io.BytesIO()
    buf.write(b'YUV4MPEG2 W%d H%d F%d:1 Ip A1:1 C420mpeg2\n' % (W, H, FPS))
    for i in range(FRAMES):
        t = i / FRAMES
        s = 1.0 + 0.03 * math.sin(2 * math.pi * t)
        vw, vh = int(W / s), int(H / s)
        frame = canvas0.crop(((W - vw) // 2, (H - vh) // 2, (W - vw) // 2 + vw, (H - vh) // 2 + vh)).resize((W, H), Image.BILINEAR)
        buf.write(b'FRAME\n')
        buf.write(to_i420(np.asarray(frame)))
    OUT.write_bytes(buf.getvalue())
    print('写出', OUT, round(OUT.stat().st_size / 1048576, 2), 'MB', FRAMES, '帧', n, '张脸（', rows, '行', cols, '列）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
