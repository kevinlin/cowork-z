// src-tauri/src/lock_util.rs
//! Poison-recovering mutex lock helper (2026-06-12 review #17).
//!
//! A mutex is poisoned when a thread panics while holding it. The protected
//! data is still structurally intact for our use cases (the SQLite connection
//! guards its own integrity transactionally; log-file handles and scheduler
//! maps tolerate a torn write), so recovering the guard is strictly better
//! than letting every subsequent `.lock().unwrap()` cascade the panic across
//! unrelated commands and background threads.

use std::sync::{Mutex, MutexGuard};

/// Lock a mutex, recovering the guard if the mutex was poisoned by a panic
/// in another thread. Logs the recovery so poisoning incidents stay visible.
pub fn lock_or_recover<'a, T>(mutex: &'a Mutex<T>, context: &str) -> MutexGuard<'a, T> {
    mutex.lock().unwrap_or_else(|poisoned| {
        eprintln!(
            "[Lock] Recovered poisoned mutex ({}) — a previous holder panicked",
            context
        );
        poisoned.into_inner()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn locks_normally_when_unpoisoned() {
        let mutex = Mutex::new(5);
        let guard = lock_or_recover(&mutex, "test");
        assert_eq!(*guard, 5);
    }

    #[test]
    fn recovers_after_poisoning() {
        let mutex = Arc::new(Mutex::new(vec![1, 2, 3]));
        let poisoner = Arc::clone(&mutex);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison the mutex");
        })
        .join();

        assert!(mutex.is_poisoned(), "mutex should be poisoned by the panic");
        let guard = lock_or_recover(&mutex, "test");
        assert_eq!(*guard, vec![1, 2, 3], "data is still accessible");
    }
}
