// 探测可离线获取的真人脸测试图（仅用于本地无头验证，不进入交付物）
const CANDIDATES = [
  'https://storage.googleapis.com/mediapipe-assets/portrait.jpg',
  'https://storage.googleapis.com/mediapipe-assets/portrait_rotated.jpg',
  'https://storage.googleapis.com/mediapipe-assets/face.jpg',
  'https://storage.googleapis.com/mediapipe-assets/person.jpg',
  'https://storage.googleapis.com/mediapipe-assets/face_blendshapes.jpg',
  'https://storage.googleapis.com/mediapipe-assets/face_landmarker.jpg',
  'https://storage.googleapis.com/mediapipe-tasks/face_landmarker/portrait.jpg',
  'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/tasks/testdata/vision/portrait.jpg',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/test/images/sample1.jpg',
  'https://raw.githubusercontent.com/vladmandic/face-api/master/demo/sample1.jpg',
];
for (const url of CANDIDATES) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'dsh' } });
    const buf = Buffer.from(await res.arrayBuffer());
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    console.log(`${res.status} ${isJpg ? 'JPEG' : isPng ? 'PNG ' : '????'} ${String(buf.length).padStart(8)}  ${url}`);
  } catch (err) {
    console.log(`ERR  ${err.message}  ${url}`);
  }
}
