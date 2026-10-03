# 第三方组件

本仓库的**自有代码**（`src/`、`index.html`、`_tools/`、文档）采用 MIT 许可（见 `LICENSE`）。
`vendor/` 目录下打包的是第三方运行时与模型，许可见下：

## MediaPipe Tasks Vision（`vendor/mediapipe/`）

- 文件：`vision_bundle.mjs`、`wasm/vision_wasm_internal.js|.wasm`、
  `wasm/vision_wasm_nosimd_internal.js|.wasm`
- 来源：<https://github.com/google-ai-edge/mediapipe>（npm 包 `@mediapipe/tasks-vision@0.10.20`）
- 许可：**Apache License 2.0** — <https://www.apache.org/licenses/LICENSE-2.0>
- 版权：Copyright 2023 The MediaPipe Authors

## 人脸关键点模型（`vendor/models/face_landmarker.task`）

- 来源：MediaPipe 官方模型库
  <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>
- 许可：**Apache License 2.0**（随 MediaPipe 项目发布）

## 说明

- 以上两项目均按 Apache-2.0 第 4 条以**未修改的原始形式**再分发，仅作为本项目的运行时依赖被内联
  （单文件版把它们 base64 内联进 `五官镜像.html`，源码版直接以文件形式提供）。
- 本仓库**不包含**任何真人照片、测试视频或人脸数据；`_tools/make_test_video.py` 在需要时会
  自行从 MediaPipe 公开资源下载其官方测试肖像用于本地验证，下载内容不进仓库。
