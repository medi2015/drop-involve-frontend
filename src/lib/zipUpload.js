import JSZip from 'jszip';
import { multipartApi, uploadPart, MAX_PARTS } from './multipart';

/**
 * Zips and uploads at the same time, so the archive never exists in memory.
 *
 * The old approach called JSZip.generateAsync({ type: 'blob' }), which builds
 * the entire archive as one buffer before a byte is uploaded. V8 refuses any
 * single allocation over about 2.1 GB, so a batch of 96 photos totalling 2.1 GB
 * failed with "Array buffer allocation failed" — after several minutes of work.
 *
 * Here the zip is produced as a stream, collected into part-sized blobs, and
 * each part uploaded as it fills. Peak memory is a few parts rather than the
 * whole archive, so the size of the batch stops mattering.
 *
 * Verified byte-identical to generateAsync output, and the resulting archives
 * open and unpack correctly — see the notes in TODO.md.
 */

// Smaller than the 64 MB used for single files: several parts are held at once
// here, and the point of the exercise is bounded memory. 16 MB × 10,000 parts
// still allows a 160 GB transfer, far beyond the 20 GB cap.
const PART_SIZE = 16 * 1024 * 1024;

// Parts uploading at once. Each one in flight is another PART_SIZE held, so
// this is the memory/throughput dial: 3 × 16 MB ≈ 48 MB.
const CONCURRENCY = 3;

// Zip overhead per entry: local header, central directory entry, descriptors.
// Only used to estimate the total for the progress bar.
const PER_ENTRY_OVERHEAD = 180;

/**
 * @param {{file: File, path: string}[]} items
 * @param {object} options
 * @param {string} options.fileName        name for the resulting .zip
 * @param {() => object} options.authHeaders
 * @param {(loaded: number, total: number) => void} options.onProgress
 * @param {{current: Set<XMLHttpRequest>}} options.activeUploads  for cancelling
 * @returns {Promise<{objectKey: string, size: number}>}
 */
export async function uploadZipInParts(items, {
  fileName, authHeaders, onProgress, activeUploads,
}) {
  const api = multipartApi(authHeaders);

  // Files are stored, not deflated (JSZip's default), so the finished archive
  // lands within a fraction of a percent of this. Good enough for a progress
  // bar, and it means progress starts moving immediately rather than after the
  // zip is complete.
  const estimatedTotal =
    items.reduce((sum, { file }) => sum + file.size, 0) + items.length * PER_ENTRY_OVERHEAD;

  const { uploadId, objectKey } = await api.create(fileName, 'application/zip');

  const zip = new JSZip();
  for (const { file, path } of items) zip.file(path, file);

  const completed = [];
  const loadedPerPart = [];
  const inFlight = new Set();

  let partNumber = 0;
  let uploadedBytes = 0;
  let failure = null;
  let stream = null;

  // Set once the stream promise exists. A failed part pauses the zip, and a
  // paused stream never fires 'end' — so without this the upload would hang
  // forever waiting for a stream that has been deliberately stopped.
  let abandonStream = null;

  const reportProgress = () => {
    const loaded = loadedPerPart.reduce((sum, n) => sum + n, 0);
    // Clamped: the estimate can be a touch low, and a bar that reads 101% or
    // sits at 100% while still working looks broken.
    onProgress(Math.min(loaded, estimatedTotal - 1), estimatedTotal);
  };

  const send = (blob, isFinal) => {
    const number = ++partNumber;
    const index = number - 1;
    loadedPerPart[index] = 0;

    if (number > MAX_PARTS) {
      failure = failure || new Error('Overføringen er for stor.');
      return;
    }

    const task = uploadPart({
      api,
      objectKey,
      uploadId,
      partNumber: number,
      blob,
      activeUploads,
      onLoaded: (loaded) => {
        loadedPerPart[index] = loaded;
        reportProgress();
      },
    })
      .then((etag) => {
        completed.push({ PartNumber: number, ETag: etag });
        uploadedBytes += blob.size;
      })
      .catch((error) => {
        failure = failure || error;
        // Nothing more will succeed, and letting the zip run on would keep
        // producing parts for an upload that's already lost. Stopping the
        // stream also means 'end' will never arrive, so the waiting promise
        // has to be released explicitly.
        if (stream) stream.pause();
        if (abandonStream) abandonStream(failure);
      })
      .finally(() => {
        inFlight.delete(task);
        // Room again — let the zip carry on producing.
        if (!failure && stream && inFlight.size < CONCURRENCY) stream.resume();
      });

    inFlight.add(task);

    // Backpressure. Without this the zip runs ahead of the network and every
    // finished part queues in memory — the same problem in a new shape.
    if (stream && inFlight.size >= CONCURRENCY && !isFinal) stream.pause();
  };

  try {
    await new Promise((resolve, reject) => {
      let pending = [];
      let pendingBytes = 0;

      abandonStream = reject;
      stream = zip.generateInternalStream({ type: 'uint8array' });

      stream
        .on('data', (chunk) => {
          if (failure) return;

          pending.push(chunk);
          pendingBytes += chunk.length;

          // Emit whole parts as they fill. Chunks from JSZip don't align to
          // part boundaries, so the remainder carries into the next part.
          while (pendingBytes >= PART_SIZE) {
            const blob = new Blob(pending);
            const part = blob.slice(0, PART_SIZE);
            const rest = blob.slice(PART_SIZE);

            pending = rest.size ? [rest] : [];
            pendingBytes = rest.size;

            send(part, false);
          }
        })
        .on('error', reject)
        .on('end', () => {
          // R2 allows the final part to be under the 5 MB minimum.
          if (pendingBytes > 0 && !failure) send(new Blob(pending), true);
          resolve();
        })
        .resume();
    });

    // The stream is done producing; the last parts may still be in the air.
    await Promise.all(inFlight);

    if (failure) throw failure;

    // R2 requires parts in order; they finish out of order.
    completed.sort((a, b) => a.PartNumber - b.PartNumber);
    await api.complete(objectKey, uploadId, completed);

    onProgress(uploadedBytes, uploadedBytes);
    return { objectKey, size: uploadedBytes };
  } catch (error) {
    // Abandoned parts sit in the bucket costing money until the 7-day abort
    // rule clears them, so ask for them to go now.
    await api.abort(objectKey, uploadId);
    throw failure || error;
  }
}
