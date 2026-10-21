// 브라우저 Tesseract 라벨 인식(서버 Vision이 없을 때의 폴백).
// 숫자·하이픈만 인식하도록 화이트리스트를 제한하고, 인식 전 대비를 높인다.

let workerPromise;

function worker(onProgress) {
  if (!window.Tesseract) throw new Error("인식 엔진을 불러오지 못했습니다.");
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", 1, {
      workerPath: `${location.origin}/vendor/tesseract/worker.min.js`,
      corePath: `${location.origin}/vendor/tesseract`,
      langPath: `${location.origin}/vendor/tesseract/lang`,
      logger: onProgress,
    }).then(async (instance) => {
      await instance.setParameters({
        tessedit_char_whitelist: "0123456789-",
        tessedit_pageseg_mode: "6",
      });
      return instance;
    });
  }
  return workerPromise;
}

async function preprocess(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      let gray = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
      gray = Math.max(0, Math.min(255, gray * 1.5 - 64)); // 대비 강화
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extractCodes(text) {
  const normalized = String(text || "").replace(/[‐-―−・－]/g, "-");
  const found = normalized.match(/\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,3}(?:\s*-\s*\d{1,4})?/g) || [];
  return [...new Set(found.map((code) => code.replace(/\s/g, "")))];
}

export async function recognize(file, onProgress) {
  const instance = await worker(onProgress);
  let input = file;
  try {
    input = await preprocess(file);
  } catch (_) { /* 전처리 실패 시 원본으로 시도 */ }
  const { data } = await instance.recognize(input);
  return extractCodes(data.text);
}
