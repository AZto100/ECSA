(() => {
  "use strict";

  const form = document.querySelector("#encode-form");
  const input = document.querySelector("#student-number");
  const encodeButton = document.querySelector("#encode-button");
  const status = document.querySelector("#form-status");
  const downloadPanel = document.querySelector("#download-panel");
  const downloadButton = document.querySelector("#download-button");
  const fileSummary = document.querySelector("#file-summary");
  const canvas = document.querySelector("#work-canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let outputUrl = null;
  let outputName = "";

  function digitsOf(studentNumber) {
    return Array.from(studentNumber, Number);
  }

  function modulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
  }

  function bands(width) {
    const q = Math.floor(width / 3);
    const r = width % 3;
    const leftEnd = q + (r >= 1 ? 1 : 0);
    const middleEnd = leftEnd + q + (r === 2 ? 1 : 0);
    return { leftEnd, middleEnd };
  }

  function pixelOffset(x, y, width) {
    return (y * width + x) * 4;
  }

  function leftShift(digits, x, y, channel) {
    const key = digits[modulo(x + y + channel, 8)];
    return modulo(17 * key + 3 * x + 5 * y + 29 * channel, 256);
  }

  function middleMask(digits, x, y, channel) {
    const key = digits[modulo(2 * x + y + channel, 8)];
    return modulo(31 * key + 7 * x + 11 * y + 13 * channel, 256);
  }

  function rightMask(digits, x, y, channel) {
    const key = digits[modulo(x + 2 * y + channel, 8)];
    return modulo(29 * key + 13 * x + 17 * y + 19 * channel, 256);
  }

  function encodePixels(imageData, digits) {
    const { data, width, height } = imageData;
    const { leftEnd, middleEnd } = bands(width);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < leftEnd; x += 1) {
        const offset = pixelOffset(x, y, width);
        for (let c = 0; c < 3; c += 1) {
          data[offset + c] = modulo(data[offset + c] + leftShift(digits, x, y, c), 256);
        }
      }

      for (let x = leftEnd; x < middleEnd; x += 1) {
        const offset = pixelOffset(x, y, width);
        const original = [data[offset], data[offset + 1], data[offset + 2]];
        const rotation = 1 + modulo(digits[modulo(x + y, 8)], 2);
        for (let c = 0; c < 3; c += 1) {
          const rotated = original[modulo(c + rotation, 3)];
          data[offset + c] = rotated ^ middleMask(digits, x, y, c);
        }
      }

      for (let x = middleEnd; x < width; x += 1) {
        const offset = pixelOffset(x, y, width);
        for (let c = 0; c < 3; c += 1) {
          data[offset + c] ^= rightMask(digits, x, y, c);
        }
      }
    }

    for (let x = middleEnd; x < width; x += 1) {
      for (let blockStart = 0; blockStart + 9 < height; blockStart += 10) {
        for (let step = 0; step < 5; step += 1) {
          const upper = pixelOffset(x, blockStart + step, width);
          const lower = pixelOffset(x, blockStart + step + 5, width);
          for (let c = 0; c < 4; c += 1) {
            const temporary = data[upper + c];
            data[upper + c] = data[lower + c];
            data[lower + c] = temporary;
          }
        }
      }
    }
  }

  function decodePixels(imageData, digits) {
    const { data, width, height } = imageData;
    const { leftEnd, middleEnd } = bands(width);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < leftEnd; x += 1) {
        const offset = pixelOffset(x, y, width);
        for (let c = 0; c < 3; c += 1) {
          data[offset + c] = modulo(data[offset + c] - leftShift(digits, x, y, c), 256);
        }
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = leftEnd; x < middleEnd; x += 1) {
        const offset = pixelOffset(x, y, width);
        const unmasked = [0, 1, 2].map(c => data[offset + c] ^ middleMask(digits, x, y, c));
        const rotation = 1 + modulo(digits[modulo(x + y, 8)], 2);
        for (let c = 0; c < 3; c += 1) {
          data[offset + c] = unmasked[modulo(c - rotation, 3)];
        }
      }
    }

    for (let x = middleEnd; x < width; x += 1) {
      for (let blockStart = 0; blockStart + 9 < height; blockStart += 10) {
        for (let step = 0; step < 5; step += 1) {
          const upper = pixelOffset(x, blockStart + step, width);
          const lower = pixelOffset(x, blockStart + step + 5, width);
          for (let c = 0; c < 4; c += 1) {
            const temporary = data[upper + c];
            data[upper + c] = data[lower + c];
            data[lower + c] = temporary;
          }
        }
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = middleEnd; x < width; x += 1) {
        const offset = pixelOffset(x, y, width);
        for (let c = 0; c < 3; c += 1) {
          data[offset + c] ^= rightMask(digits, x, y, c);
        }
      }
    }
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function randomIndex(length) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % length;
  }

  async function loadManifest() {
    const response = await fetch("images/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("The image list could not be loaded.");
    const list = await response.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error("No source images are available.");
    return list;
  }

  function loadImage(path) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The selected source image could not be loaded."));
      image.src = path;
    });
  }

  function canvasBlob() {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG creation failed.")), "image/png");
    });
  }

  function setBusy(busy) {
    encodeButton.disabled = busy;
    input.disabled = busy;
    encodeButton.textContent = busy ? "Encoding…" : "Encode image";
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    downloadPanel.hidden = true;
    status.className = "status";
    const studentNumber = input.value.trim();

    if (!/^\d{8}$/.test(studentNumber)) {
      status.textContent = "Enter exactly eight digits.";
      status.classList.add("error");
      input.focus();
      return;
    }

    setBusy(true);
    status.textContent = "Selecting and encoding an image on this device…";

    try {
      const sources = await loadManifest();
      const image = await loadImage(sources[randomIndex(sources.length)]);
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);

      const original = context.getImageData(0, 0, canvas.width, canvas.height);
      const encoded = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
      const keyDigits = digitsOf(studentNumber);
      encodePixels(encoded, keyDigits);

      const verification = new ImageData(new Uint8ClampedArray(encoded.data), encoded.width, encoded.height);
      decodePixels(verification, keyDigits);
      if (!arraysEqual(original.data, verification.data)) {
        throw new Error("The internal round-trip verification failed.");
      }

      context.putImageData(encoded, 0, 0);
      const blob = await canvasBlob();
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      outputUrl = URL.createObjectURL(blob);
      outputName = `IMG3_${studentNumber}_encoded.png`;
      fileSummary.textContent = `${canvas.width} × ${canvas.height} px · ${Math.max(1, Math.round(blob.size / 1024))} KB`;
      downloadPanel.hidden = false;
      status.textContent = "Encoding complete. Exact recovery was verified before download.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "The image could not be encoded.";
      status.classList.add("error");
    } finally {
      setBusy(false);
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!outputUrl) return;
    const link = document.createElement("a");
    link.href = outputUrl;
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  window.addEventListener("beforeunload", () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  });
})();
