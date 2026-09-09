/**
 * The broadcast bus for live viewers.
 *
 * One set of subscribers per share token. A push from the organizer fans out to
 * everyone currently watching that token; nothing is buffered, because a viewer
 * who connects late gets the current snapshot from the GET before the stream
 * starts, and a viewer who misses a frame gets the next one.
 */

export type Subscriber = (payload: string) => void;

export interface Bus {
  subscribe(readToken: string, subscriber: Subscriber): () => void;
  publish(readToken: string, payload: string): void;
  /** Live subscriber count, for the health endpoint and for tests. */
  size(readToken: string): number;
}

export function createBus(): Bus {
  const rooms = new Map<string, Set<Subscriber>>();

  return {
    subscribe(readToken, subscriber) {
      let room = rooms.get(readToken);
      if (!room) {
        room = new Set();
        rooms.set(readToken, room);
      }
      room.add(subscriber);

      return () => {
        const current = rooms.get(readToken);
        if (!current) return;
        current.delete(subscriber);
        // Drop the room when the last viewer leaves, so a long-lived server
        // does not accumulate an empty set per tournament ever shared.
        if (current.size === 0) rooms.delete(readToken);
      };
    },

    publish(readToken, payload) {
      const room = rooms.get(readToken);
      if (!room) return;
      // Copy before iterating: a failing send unsubscribes, which mutates the
      // set we would otherwise be walking.
      for (const subscriber of [...room]) {
        try {
          subscriber(payload);
        } catch {
          room.delete(subscriber);
        }
      }
    },

    size(readToken) {
      return rooms.get(readToken)?.size ?? 0;
    },
  };
}
