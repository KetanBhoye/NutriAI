type Event = 'goals';
type Listener = () => void;

const listeners: Record<Event, Listener[]> = {
  goals: [],
};

export function subscribe(event: Event, listener: Listener) {
  listeners[event].push(listener);
  return () => {
    const index = listeners[event].indexOf(listener);
    if (index > -1) listeners[event].splice(index, 1);
  };
}

export function broadcast(event: Event) {
  for (const listener of listeners[event]) {
    listener();
  }
}
