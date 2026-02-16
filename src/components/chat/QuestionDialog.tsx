import { AnimatePresence, motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { springs } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { QuestionRequest } from '@/shared';

interface QuestionDialogProps {
  request: QuestionRequest;
  onSubmit: (answers: Array<{ labels: string[]; customText?: string }>) => void;
  onCancel: () => void;
}

export function QuestionDialog({ request, onSubmit, onCancel }: QuestionDialogProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customResponse, setCustomResponse] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [answers, setAnswers] = useState<Array<{ labels: string[]; customText?: string }>>([]);

  const questions = request.questions;
  const currentQuestion = questions[currentQuestionIndex];
  if (!currentQuestion) return null;

  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  const handleSubmitCurrent = () => {
    const answer: { labels: string[]; customText?: string } = showCustomInput
      ? { labels: [], customText: customResponse.trim() }
      : { labels: selectedOptions };

    if (isLastQuestion) {
      onSubmit([...answers, answer]);
    } else {
      setAnswers([...answers, answer]);
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOptions([]);
      setCustomResponse('');
      setShowCustomInput(false);
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      const previousAnswers = answers.slice(0, -1);
      setAnswers(previousAnswers);
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      setSelectedOptions([]);
      setCustomResponse('');
      setShowCustomInput(false);
    }
  };

  const canSubmit = showCustomInput ? customResponse.trim().length > 0 : selectedOptions.length > 0;

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        data-testid="question-dialog"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
      >
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={springs.bouncy}
        >
          <Card className="mx-4 w-full max-w-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="font-semibold text-foreground text-lg">{currentQuestion.header || 'Question'}</h3>
                  {questions.length > 1 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                      {currentQuestionIndex + 1} / {questions.length}
                    </span>
                  )}
                </div>

                <p className="mb-4 text-foreground text-sm">{currentQuestion.question}</p>

                {/* Options list */}
                {!showCustomInput && currentQuestion.options && currentQuestion.options.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {currentQuestion.options.map((option, idx) => (
                      <button
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-colors',
                          selectedOptions.includes(option.label) ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                        )}
                        key={idx}
                        onClick={() => {
                          if (option.label.toLowerCase() === 'other') {
                            setShowCustomInput(true);
                            setSelectedOptions([]);
                            return;
                          }
                          if (currentQuestion.multiSelect) {
                            setSelectedOptions((prev) =>
                              prev.includes(option.label) ? prev.filter((o) => o !== option.label) : [...prev, option.label]
                            );
                          } else {
                            setSelectedOptions([option.label]);
                          }
                        }}
                      >
                        <div className="font-medium text-sm">{option.label}</div>
                        {option.description && <div className="mt-1 text-muted-foreground text-xs">{option.description}</div>}
                      </button>
                    ))}
                  </div>
                )}

                {/* Custom text input */}
                {showCustomInput && (
                  <div className="mb-4 space-y-2">
                    <Input
                      autoFocus
                      onChange={(e) => setCustomResponse(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter' && customResponse.trim()) {
                          handleSubmitCurrent();
                        }
                      }}
                      placeholder="Type your response..."
                      value={customResponse}
                    />
                    <button
                      className="text-muted-foreground text-xs hover:text-foreground"
                      onClick={() => {
                        setShowCustomInput(false);
                        setCustomResponse('');
                      }}
                    >
                      Back to options
                    </button>
                  </div>
                )}

                {/* No options - free-text only */}
                {!(currentQuestion.options?.length || showCustomInput) && (
                  <div className="mb-4">
                    <Input
                      autoFocus
                      onChange={(e) => setCustomResponse(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter' && customResponse.trim()) {
                          handleSubmitCurrent();
                        }
                      }}
                      placeholder="Type your response..."
                      value={customResponse}
                    />
                  </div>
                )}

                <div className="flex gap-3">
                  {currentQuestionIndex > 0 ? (
                    <Button className="flex-1" onClick={handleBack} variant="outline">
                      Back
                    </Button>
                  ) : (
                    <Button className="flex-1" onClick={onCancel} variant="outline">
                      Cancel
                    </Button>
                  )}
                  <Button
                    className="flex-1"
                    disabled={!(canSubmit || (!currentQuestion.options?.length && customResponse.trim()))}
                    onClick={handleSubmitCurrent}
                  >
                    {isLastQuestion ? 'Submit' : 'Next'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
