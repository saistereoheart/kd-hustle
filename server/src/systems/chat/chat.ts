// Chat text cleaning + a small in-memory history. The client renders chat with textContent
// (never innerHTML), but we still strip control chars and cap the length here.
import type { ChatMsg } from '@kh/shared';

export function sanitizeChat(text: string, maxLength: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export class ChatHistory {
  private items: ChatMsg[] = [];
  private nextId = 1;

  constructor(private readonly size: number) {}

  add(m: Omit<ChatMsg, 'id' | 't'>): ChatMsg {
    const msg: ChatMsg = { ...m, id: this.nextId++, t: Date.now() };
    this.items.push(msg);
    if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size);
    return msg;
  }

  list(): ChatMsg[] {
    return [...this.items];
  }
}
