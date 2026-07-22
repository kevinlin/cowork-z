use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// The single "one automation run at a time" execution slot (v1 sequential model).
pub struct DispatchSlot {
    running: Arc<AtomicBool>,
}

/// Held for the lifetime of a dispatched run. Releases the slot on drop.
pub struct SlotGuard {
    running: Arc<AtomicBool>,
}

impl DispatchSlot {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// CAS false→true. `Some(guard)` iff the slot was free; the guard releases on drop.
    pub fn try_acquire(&self) -> Option<SlotGuard> {
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| SlotGuard {
                running: self.running.clone(),
            })
    }
}

impl Default for DispatchSlot {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_free_slot_returns_guard() {
        let slot = DispatchSlot::new();
        assert!(slot.try_acquire().is_some());
    }

    #[test]
    fn second_acquire_while_held_returns_none() {
        let slot = DispatchSlot::new();
        let _guard = slot.try_acquire().expect("first acquire");
        assert!(slot.try_acquire().is_none());
    }

    #[test]
    fn drop_guard_frees_slot() {
        let slot = DispatchSlot::new();
        let guard = slot.try_acquire().expect("first acquire");
        drop(guard);
        assert!(slot.try_acquire().is_some());
    }

    #[test]
    fn guard_dropped_on_scope_exit_releases() {
        let slot = DispatchSlot::new();
        {
            let _guard = slot.try_acquire().expect("first acquire");
            assert!(slot.try_acquire().is_none());
        }
        assert!(slot.try_acquire().is_some());
    }
}
