/**
 * Typed subscription helper for sidecar events.
 *
 * Rust forwards every sidecar event verbatim as `sidecar:{type}` (see
 * `src-tauri/src/sidecar.rs`), so the event name and payload shape both derive
 * from the sidecar's own `SidecarEvent` union. Adding a member to that union is
 * immediately a legal `type` here with a correctly typed handler — nothing in
 * this file needs to change.
 */
import type { SidecarEvent } from '@sidecar/types';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Every event type the sidecar can emit. */
export type SidecarEventType = SidecarEvent['type'];

/** The full event object for a given sidecar event type. */
export type SidecarEventOf<K extends SidecarEventType> = Extract<SidecarEvent, { type: K }>;

/**
 * Subscribe to one sidecar event type.
 *
 * The handler receives the **whole** event, not just `payload`, because
 * `taskId` is a sibling of `payload` on most members — `{ taskId, payload }`
 * destructuring at the call site beats two separate accessors.
 */
export function onSidecarEvent<K extends SidecarEventType>(type: K, handler: (event: SidecarEventOf<K>) => void): Promise<UnlistenFn> {
  return listen<SidecarEventOf<K>>(`sidecar:${type}`, (event) => handler(event.payload));
}
