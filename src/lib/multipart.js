import { API_BASE } from './api';

/**
 * Multipart upload to R2.
 *
 * R2 accepts at most 4.995 GiB in a single PUT, so larger files must be split
 * and reassembled server-side. Beyond raising the ceiling, this uploads several
 * parts at once (usually much faster than one stream), retries a failed part
 * instead of the whole file, and avoids the one-hour presigned URL expiry that
 * a 20 GB upload would otherwise outlast.
 */

// Below this a single PUT is simpler and involves fewer round trips.
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB

const MIN_PART_SIZE = 5 * 1024 * 1024;   // R2's floor for non-final parts
const TARGET_PART_SIZE = 64 * 1024 * 1024;
export const MAX_PARTS = 10000;          // R2's ceiling
const CONCURRENCY = 3;
export const PART_RETRIES = 3;

/** Big enough to stay under the part limit, never below R2's minimum. */
export const partSizeFor = (fileSize) =>
  Math.max(MIN_PART_SIZE, TARGET_PART_SIZE, Math.ceil(fileSize / (MAX_PARTS - 1)));

export const putPart = (url, blob, { onProgress, registerXhr }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerXhr(xhr);

    xhr.open('PUT', url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(`Del feilet (${xhr.status})`));
      }

      // R2 returns the part's ETag, which the completion call needs. Reading it
      // cross-origin requires ETag in the bucket's CORS ExposeHeaders — without
      // that this is null and the upload can't be completed.
      const etag = xhr.getResponseHeader('ETag');
      if (!etag) {
        return reject(new Error('Fikk ingen ETag fra lagringen. Sjekk CORS-innstillingene for R2.'));
      }

      resolve(etag);
    };

    xhr.onerror = () => reject(new Error('Nettverksfeil under opplasting.'));
    xhr.onabort = () => reject(Object.assign(new Error('Avbrutt'), { aborted: true }));

    xhr.send(blob);
  });

/**
 * The four server calls a multipart upload needs, bound to one session.
 *
 * Shared with the streaming zip upload, so both take the same route through
 * the API and a change to error handling applies to both.
 */
export const multipartApi = (authHeaders) => {
  const post = async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || 'Opplastingen feilet.');
    }
    return res.json();
  };

  return {
    create: (fileName, contentType) =>
      post('/multipart/create', { fileName, contentType: contentType || 'application/octet-stream' }),
    sign: (objectKey, uploadId, partNumbers) =>
      post('/multipart/sign', { objectKey, uploadId, partNumbers }),
    complete: (objectKey, uploadId, parts) =>
      post('/multipart/complete', { objectKey, uploadId, parts }),
    abort: (objectKey, uploadId) =>
      post('/multipart/abort', { objectKey, uploadId }).catch(() => {}),
  };
};

/**
 * Uploads one part, re-signing on each attempt so a URL can't go stale
 * mid-retry. Shared by both upload paths.
 */
export const uploadPart = async ({
  api, objectKey, uploadId, partNumber, blob, onLoaded, activeUploads,
}) => {
  let lastError;

  for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
    try {
      const { urls } = await api.sign(objectKey, uploadId, [partNumber]);

      const etag = await putPart(urls[partNumber], blob, {
        onProgress: onLoaded,
        registerXhr: (xhr) => activeUploads.current.add(xhr),
      });

      onLoaded(blob.size);
      return etag;
    } catch (error) {
      if (error.aborted) throw error;
      lastError = error;
      onLoaded(0);
      if (attempt < PART_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  throw lastError;
};

/**
 * @param {File} file
 * @param {object} options
 * @param {() => object} options.authHeaders
 * @param {(loaded: number, total: number) => void} options.onProgress
 * @param {{current: Set<XMLHttpRequest>}} options.activeUploads  for cancelling
 * @returns {Promise<string>} the object key
 */
export async function uploadInParts(file, { authHeaders, onProgress, activeUploads }) {
  const api = multipartApi(authHeaders);

  const { uploadId, objectKey } = await api.create(
    file.name,
    file.type || 'application/octet-stream'
  );

  const partSize = partSizeFor(file.size);
  const partCount = Math.ceil(file.size / partSize);

  // Progress is the sum across parts, so a part restarting can't make the
  // total run backwards — each part reports its own latest figure.
  const loadedPerPart = new Array(partCount).fill(0);
  const reportProgress = () =>
    onProgress(loadedPerPart.reduce((sum, n) => sum + n, 0), file.size);

  try {
    const completed = [];
    let nextPart = 0;

    const worker = async () => {
      while (nextPart < partCount) {
        const index = nextPart++;
        const partNumber = index + 1;
        const blob = file.slice(index * partSize, Math.min((index + 1) * partSize, file.size));

        const etag = await uploadPart({
          api,
          objectKey,
          uploadId,
          partNumber,
          blob,
          activeUploads,
          onLoaded: (loaded) => {
            loadedPerPart[index] = loaded;
            reportProgress();
          },
        });

        completed.push({ PartNumber: partNumber, ETag: etag });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, partCount) }, worker));

    await api.complete(objectKey, uploadId, completed);

    return objectKey;
  } catch (error) {
    // Leaving parts behind would sit in the bucket costing money.
    await api.abort(objectKey, uploadId);
    throw error;
  }
}
