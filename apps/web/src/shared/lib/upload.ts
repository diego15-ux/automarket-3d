/** URL prefirmada que devuelve la API (KYC y adjuntos del chat). */
export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}

/**
 * Sube el archivo DIRECTO al almacenamiento (S3) con la URL prefirmada.
 * Usa XMLHttpRequest porque fetch todavía no expone el progreso de subida.
 */
export function uploadToStorage(upload: PresignedUpload, file: Blob, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.uploadUrl);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('La subida falló. Inténtalo de nuevo.')));
    xhr.onerror = () => reject(new Error('Error de red durante la subida.'));
    xhr.onabort = () => reject(new DOMException('Subida cancelada', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
