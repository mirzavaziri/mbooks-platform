import { EventEmitter } from 'node:events';

export type ChangeEvent = {
  collection: 'sections' | 'blocks' | 'settings';
  id: string;
  version: number;
  deleted?: boolean;
  data?: unknown;
  byUserId: string;
};

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishChange(bookId: string, event: ChangeEvent) {
  bus.emit(bookId, event);
}

export function subscribeChanges(bookId: string, fn: (event: ChangeEvent) => void): () => void {
  bus.on(bookId, fn);
  return () => bus.off(bookId, fn);
}
