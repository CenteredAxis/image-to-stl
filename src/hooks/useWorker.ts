import { useEffect, useRef, useCallback } from 'react';

export function useWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>());
  const nextId = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL('../lib/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, error, ...data } = e.data;
      const p = pending.current.get(id);
      if (!p) return;
      pending.current.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(data);
    };
    w.onerror = (e) => console.error('Worker crashed:', e);
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
      for (const p of pending.current.values()) p.reject(new Error('Worker terminated'));
      pending.current.clear();
    };
  }, []);

  const post = useCallback(<T>(msg: object, transfers: Transferable[] = []): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) { reject(new Error('Worker not ready')); return; }
      const id = nextId.current++;
      pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject });
      workerRef.current.postMessage({ ...msg, id }, transfers);
    });
  }, []);

  return post;
}
