// apps/desktop/src/renderer/components/settings/shared/FormError.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { settingsTransitions, settingsVariants } from '@/lib/animations';

interface FormErrorProps {
  error: string | null;
}

export function FormError({ error }: FormErrorProps) {
  return (
    <AnimatePresence>
      {error && (
        <motion.p
          animate="animate"
          className="text-destructive text-sm"
          exit="exit"
          initial="initial"
          transition={settingsTransitions.enter}
          variants={settingsVariants.fadeSlide}
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
