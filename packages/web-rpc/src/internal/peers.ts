export class PeerRegistry<T extends string = string> {
  readonly #ids = new Set<T>();
  add(id: T): void {
    this.#ids.add(id);
  }
  snapshot(): readonly T[] {
    return [...this.#ids];
  }
  remove(id: T): void {
    this.#ids.delete(id);
  }
}
