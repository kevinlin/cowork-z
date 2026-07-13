import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { springs } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { QuestionRequest } from '@/shared';

const OTHERS_LABEL = 'Others';
const OTHERS_DESCRIPTION = 'Type your own response';

const isOthersLabel = (label: string) => ['other', 'others'].includes(label.trim().toLowerCase());

function ResponseInput({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <Input
      autoFocus
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && value.trim()) onSubmit();
      }}
      placeholder="Type your response..."
      value={value}
    />
  );
}

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
  const [othersSelected, setOthersSelected] = useState(false);
  const [answers, setAnswers] = useState<Array<{ labels: string[]; customText?: string }>>([]);

  const questions = request.questions;
  const currentQuestion = questions[currentQuestionIndex];
  if (!currentQuestion) return null;

  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  const providedOptions = currentQuestion.options ?? [];
  const hasFreeTextOption = providedOptions.some((o) => isOthersLabel(o.label));
  const renderedOptions =
    providedOptions.length === 0 || hasFreeTextOption
      ? providedOptions
      : [...providedOptions, { label: OTHERS_LABEL, description: OTHERS_DESCRIPTION }];

  const trimmedCustom = customResponse.trim();
  const totalSelections = selectedOptions.length + (currentQuestion.multiSelect && othersSelected ? 1 : 0);

  const resetQuestionState = () => {
    setSelectedOptions([]);
    setCustomResponse('');
    setShowCustomInput(false);
    setOthersSelected(false);
  };

  const buildCurrentAnswer = (): { labels: string[]; customText?: string } => {
    if (currentQuestion.multiSelect) {
      return {
        labels: selectedOptions,
        customText: othersSelected && trimmedCustom.length > 0 ? trimmedCustom : undefined,
      };
    }
    if (showCustomInput || renderedOptions.length === 0) {
      return { labels: [], customText: trimmedCustom };
    }
    return { labels: selectedOptions };
  };

  const handleSubmitCurrent = () => {
    const answer = buildCurrentAnswer();

    if (isLastQuestion) {
      onSubmit([...answers, answer]);
    } else {
      setAnswers([...answers, answer]);
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      resetQuestionState();
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      const previousAnswers = answers.slice(0, -1);
      setAnswers(previousAnswers);
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      resetQuestionState();
    }
  };

  const canSubmit = (() => {
    if (currentQuestion.multiSelect) {
      return selectedOptions.length > 0 || (othersSelected && trimmedCustom.length > 0);
    }
    if (showCustomInput || renderedOptions.length === 0) return trimmedCustom.length > 0;
    return selectedOptions.length > 0;
  })();

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
        data-testid="question-dialog"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
      >
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          drag
          dragConstraints={{ top: -200, left: -300, right: 300, bottom: 200 }}
          dragElastic={0.1}
          dragMomentum={false}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={springs.gentle}
        >
          <Card className="mx-4 w-full max-w-lg cursor-grab p-6 active:cursor-grabbing">
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

                <p className="mb-2 text-foreground text-sm">{currentQuestion.question}</p>
                {currentQuestion.multiSelect && <p className="mb-3 text-muted-foreground text-xs">Select one or more options</p>}

                {/* Options list */}
                {!showCustomInput && renderedOptions.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {renderedOptions.map((option, idx) => {
                      const labelIsOthers = isOthersLabel(option.label);
                      const optionSelected = labelIsOthers
                        ? currentQuestion.multiSelect && othersSelected
                        : selectedOptions.includes(option.label);
                      return (
                        <button
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors',
                            optionSelected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                          )}
                          key={`${option.label}-${idx}`}
                          onClick={() => {
                            if (labelIsOthers) {
                              if (currentQuestion.multiSelect) {
                                setOthersSelected((prev) => {
                                  const next = !prev;
                                  if (!next) setCustomResponse('');
                                  return next;
                                });
                                return;
                              }
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
                          <div className="flex items-start gap-2.5">
                            {currentQuestion.multiSelect && (
                              <div
                                className={cn(
                                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                                  optionSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                                )}
                              >
                                {optionSelected && <Check className="h-3 w-3" />}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm">{option.label}</div>
                              {option.description && <div className="mt-1 text-muted-foreground text-xs">{option.description}</div>}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {currentQuestion.multiSelect && othersSelected && (
                      <ResponseInput onChange={setCustomResponse} onSubmit={handleSubmitCurrent} value={customResponse} />
                    )}
                  </div>
                )}

                {showCustomInput && (
                  <div className="mb-4 space-y-2">
                    <ResponseInput onChange={setCustomResponse} onSubmit={handleSubmitCurrent} value={customResponse} />
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

                {renderedOptions.length === 0 && !showCustomInput && (
                  <div className="mb-4">
                    <ResponseInput onChange={setCustomResponse} onSubmit={handleSubmitCurrent} value={customResponse} />
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
                  <Button className="flex-1" disabled={!canSubmit} onClick={handleSubmitCurrent}>
                    {isLastQuestion ? 'Submit' : 'Next'}
                    {currentQuestion.multiSelect && totalSelections > 1 && (
                      <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] leading-none">
                        {totalSelections}
                      </span>
                    )}
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
