// Template: the frontend half, in src/lib/tauri-api.ts
//
// Place the wrapper next to the other functions for its domain. Every invoke()
// and listen() in the app goes through this file — it is the frontend↔Rust
// contract, so do not call invoke() from a component.

// No-argument command. The string is the exact Rust fn name (snake_case).
export async function exampleCommand(): Promise<string> {
  return invoke<string>('example_command');
}

// With arguments. Keys are camelCase here and bind to snake_case Rust params:
//   { someArg }  ->  some_arg: String
//   { folderPath }  ->  folder_path: String
// A mismatch is silent — the argument arrives empty instead of erroring.
export async function exampleCommandWithArgs(someArg: string): Promise<string> {
  return invoke<string>('example_command', { someArg });
}

// Optional Rust params (`Option<u64>`) map to optional TS params. Omit the key
// entirely rather than passing undefined.
export async function examplePathCommand(path: string, maxSize?: number): Promise<number> {
  return invoke<number>('example_path_command', { path, maxSize });
}

// Event listener. Return the unlisten fn through toSyncUnlisten() so a
// useEffect cleanup that runs before registration resolves still unsubscribes.
export function onExampleEvent(handler: (payload: string) => void): () => void {
  return toSyncUnlisten(listen<string>('example:changed', (event) => handler(event.payload)));
}

// The event name must match the Rust `app.emit("example:changed", ...)` string
// exactly. Nothing checks this at build time.
