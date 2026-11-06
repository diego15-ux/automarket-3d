const loaded = new Map<string, Promise<void>>();

/** Carga un script externo una sola vez (SDKs de Google Identity y Sign in with Apple). */
export function loadScript(src: string): Promise<void> {
  let promise = loaded.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loaded.delete(src);
        reject(new Error(`No se pudo cargar ${src}`));
      };
      document.head.append(script);
    });
    loaded.set(src, promise);
  }
  return promise;
}
