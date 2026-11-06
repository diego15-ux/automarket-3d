'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Mismo límite que la API (5 min). */
export const MAX_VOICE_NOTE_MS = 5 * 60_000;

// Chrome/Firefox graban WebM/Opus; Safari, MP4/AAC.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

const extensionFor = (mimeType: string) => (mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm');

/** Graba una nota de voz con MediaRecorder y la entrega como File al terminar. */
export function useVoiceRecorder(onComplete: (file: File, durationMs: number) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const discardOnStop = useRef(false);
  const ticker = useRef<ReturnType<typeof setInterval>>(undefined);
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  });

  const reset = useCallback(() => {
    clearInterval(ticker.current);
    recorder.current?.stream.getTracks().forEach(track => track.stop()); // apaga el indicador de micrófono
    recorder.current = null;
    setRecording(false);
    setElapsedMs(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!window.isSecureContext) {
      setError('Las notas de voz necesitan https. Por la red local (http://…) el navegador no deja usar el micrófono.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar audio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type));
      const instance = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      chunks.current = [];
      discardOnStop.current = false;

      instance.ondataavailable = event => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      instance.onstop = () => {
        const durationMs = Date.now() - startedAt.current;
        const type = (instance.mimeType || preferred || 'audio/webm').toLowerCase();
        const blob = new Blob(chunks.current, { type });
        reset();
        if (!discardOnStop.current && blob.size > 0) {
          completeRef.current(new File([blob], `nota-de-voz.${extensionFor(type)}`, { type }), durationMs);
        }
      };

      recorder.current = instance;
      startedAt.current = Date.now();
      instance.start(250);
      setRecording(true);
      ticker.current = setInterval(() => {
        const elapsed = Date.now() - startedAt.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_VOICE_NOTE_MS && instance.state === 'recording') instance.stop();
      }, 200);
    } catch {
      setError('Necesitamos permiso para usar el micrófono.');
      reset();
    }
  }, [reset]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discardOnStop.current = true;
    stop();
  }, [stop]);

  // Si el componente se desmonta grabando, se descarta la grabación.
  useEffect(
    () => () => {
      discardOnStop.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
    },
    [],
  );

  return { recording, elapsedMs, error, start, stop, cancel };
}
