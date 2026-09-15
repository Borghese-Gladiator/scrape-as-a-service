import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

/** Reject an entry that would escape the output folder. */
function safeEntryName(name: string): string {
  const cleaned = normalize(name).replace(/^(\.\.(\/|\\|$))+/, '');
  if (cleaned.length === 0 || cleaned.startsWith('/') || cleaned.startsWith('\\')) {
    throw new Error(`unsafe zip entry: ${name}`);
  }
  return cleaned;
}

/**
 * Read a zip file entry by entry and write each one to `outDir`. The archive
 * never sits in memory: one entry stream is open at a time.
 */
export function unpackZip(zipPath: string, outDir: string): Promise<string[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr || !zipfile) {
        rejectPromise(openErr ?? new Error('cannot open the archive'));
        return;
      }
      const written: string[] = [];

      zipfile.on('error', rejectPromise);
      zipfile.on('end', () => resolvePromise(written));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) {
          zipfile.readEntry();
          return;
        }
        let target: string;
        try {
          target = join(outDir, safeEntryName(entry.fileName));
        } catch (err) {
          rejectPromise(err as Error);
          return;
        }
        zipfile.openReadStream(entry, (readErr, stream) => {
          if (readErr || !stream) {
            rejectPromise(readErr ?? new Error(`cannot read ${entry.fileName}`));
            return;
          }
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => {
              written.push(entry.fileName);
              zipfile.readEntry();
            })
            .catch(rejectPromise);
        });
      });

      zipfile.readEntry();
    });
  });
}
