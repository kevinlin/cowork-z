import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Brain, File } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { springs } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { PermissionRequest } from '@/shared';

function getOperationBadgeClasses(operation?: string): string {
  switch (operation) {
    case 'delete':
      return 'bg-destructive/10 text-destructive-emphasis';
    case 'overwrite':
      return 'bg-warning/10 text-warning-emphasis';
    case 'create':
      return 'bg-success/10 text-success-emphasis';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function isDeleteOperation(request: { type: string; fileOperation?: string }): boolean {
  return request.type === 'file' && request.fileOperation === 'delete';
}

function getDisplayFilePaths(request: { filePath?: string; filePaths?: string[] }): string[] {
  if (request.filePaths && request.filePaths.length > 0) {
    return request.filePaths;
  }
  if (request.filePath) {
    return [request.filePath];
  }
  return [];
}

interface PermissionModalProps {
  request: PermissionRequest;
  onRespond: (allowed: boolean, selectedOptions?: string[], customText?: string) => void;
}

export function PermissionModal({ request, onRespond }: PermissionModalProps) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customResponse, setCustomResponse] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleResponse = (allowed: boolean) => {
    const isQuestion = request.type === 'question';
    const hasCustomText = isQuestion && showCustomInput && customResponse.trim();

    onRespond(allowed, isQuestion ? (hasCustomText ? [] : selectedOptions) : undefined, hasCustomText ? customResponse.trim() : undefined);

    setSelectedOptions([]);
    setCustomResponse('');
    setShowCustomInput(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
        data-testid="execution-permission-modal"
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
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  isDeleteOperation(request)
                    ? 'bg-destructive/10'
                    : request.type === 'file'
                      ? 'bg-warning/10'
                      : request.type === 'question'
                        ? 'bg-primary/10'
                        : 'bg-warning/10'
                )}
              >
                {isDeleteOperation(request) ? (
                  <AlertTriangle className="h-5 w-5 text-destructive-emphasis" />
                ) : request.type === 'file' ? (
                  <File className="h-5 w-5 text-warning-emphasis" />
                ) : request.type === 'question' ? (
                  <Brain className="h-5 w-5 text-primary" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-warning-emphasis" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  className={cn('mb-2 font-semibold text-lg', isDeleteOperation(request) ? 'text-destructive-emphasis' : 'text-foreground')}
                >
                  {isDeleteOperation(request)
                    ? 'File Deletion Warning'
                    : request.type === 'file'
                      ? 'File Permission Required'
                      : request.type === 'question'
                        ? request.header || 'Question'
                        : 'Permission Required'}
                </h3>

                {/* File permission specific UI */}
                {request.type === 'file' && (
                  <>
                    {isDeleteOperation(request) && (
                      <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
                        <p className="text-destructive-emphasis text-sm">
                          {(() => {
                            const paths = getDisplayFilePaths(request);
                            return paths.length > 1
                              ? `${paths.length} files will be permanently deleted:`
                              : 'This file will be permanently deleted:';
                          })()}
                        </p>
                      </div>
                    )}

                    {!isDeleteOperation(request) && (
                      <div className="mb-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-2 py-0.5 font-medium text-xs',
                            getOperationBadgeClasses(request.fileOperation)
                          )}
                        >
                          {request.fileOperation?.toUpperCase()}
                        </span>
                      </div>
                    )}

                    <div
                      className={cn(
                        'mb-4 rounded-lg p-3',
                        isDeleteOperation(request) ? 'border border-destructive/20 bg-destructive/5' : 'bg-muted'
                      )}
                    >
                      {(() => {
                        const paths = getDisplayFilePaths(request);
                        if (paths.length > 1) {
                          return (
                            <ul className="space-y-1">
                              {paths.map((path, idx) => (
                                <li
                                  className={cn(
                                    'break-all font-mono text-sm',
                                    isDeleteOperation(request) ? 'text-destructive-emphasis' : 'text-foreground'
                                  )}
                                  key={idx}
                                >
                                  {path}
                                </li>
                              ))}
                            </ul>
                          );
                        }
                        return (
                          <p
                            className={cn(
                              'break-all font-mono text-sm',
                              isDeleteOperation(request) ? 'text-destructive-emphasis' : 'text-foreground'
                            )}
                          >
                            {paths[0]}
                          </p>
                        );
                      })()}
                      {request.targetPath && <p className="mt-1 font-mono text-muted-foreground text-sm">{request.targetPath}</p>}
                    </div>

                    {isDeleteOperation(request) && (
                      <p className="mb-4 text-destructive-emphasis/90 text-sm">This action cannot be undone.</p>
                    )}

                    {request.contentPreview && (
                      <details className="mb-4">
                        <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">Preview content</summary>
                        <pre className="mt-2 max-h-32 overflow-x-auto overflow-y-auto rounded bg-muted p-2 text-xs">
                          {request.contentPreview}
                        </pre>
                      </details>
                    )}
                  </>
                )}

                {/* Question type UI with options */}
                {request.type === 'question' && (
                  <>
                    <p className="mb-4 text-foreground text-sm">{request.question}</p>

                    {!showCustomInput && request.options && request.options.length > 0 && (
                      <div className="mb-4 space-y-2">
                        {request.options.map((option, idx) => (
                          <button
                            className={cn(
                              'w-full rounded-lg border p-3 text-left transition-colors',
                              selectedOptions.includes(option.label)
                                ? 'border-primary bg-primary/10'
                                : 'border-border hover:border-primary/50'
                            )}
                            key={idx}
                            onClick={() => {
                              if (option.label.toLowerCase() === 'other') {
                                setShowCustomInput(true);
                                setSelectedOptions([]);
                                return;
                              }
                              if (request.multiSelect) {
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

                    {showCustomInput && (
                      <div className="mb-4 space-y-2">
                        <Input
                          autoFocus
                          onChange={(e) => setCustomResponse(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                            if (e.key === 'Enter' && customResponse.trim()) {
                              handleResponse(true);
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
                  </>
                )}

                {/* Standard tool UI (non-file, non-question) */}
                {request.type === 'tool' && (
                  <>
                    <p className="mb-4 text-muted-foreground text-sm">Allow {request.toolName?.replace(/_/g, ' ')}?</p>

                    {request.patterns && request.patterns.length > 0 && (
                      <div className="mb-4 rounded-lg bg-muted p-3">
                        {request.patterns.length === 1 ? (
                          <p className="break-all font-mono text-foreground text-sm">{request.patterns[0]}</p>
                        ) : (
                          <ul className="space-y-1">
                            {request.patterns.map((pattern, idx) => (
                              <li className="break-all font-mono text-foreground text-sm" key={idx}>
                                {pattern}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {(!request.patterns || request.patterns.length === 0) && request.toolName && (
                      <div className="mb-4 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                        <p className="mb-1 text-muted-foreground">Tool: {request.toolName}</p>
                        <pre className="text-foreground">{JSON.stringify(request.toolInput, null, 2)}</pre>
                      </div>
                    )}
                  </>
                )}

                <div className="flex gap-3">
                  <Button className="flex-1" data-testid="permission-deny-button" onClick={() => handleResponse(false)} variant="outline">
                    {request.type === 'question' ? 'Cancel' : 'Deny'}
                  </Button>
                  <Button
                    className={cn(
                      'flex-1',
                      isDeleteOperation(request) && 'bg-destructive-emphasis text-destructive-foreground hover:bg-destructive-emphasis/90'
                    )}
                    data-testid="permission-allow-button"
                    disabled={request.type === 'question' && !showCustomInput && request.options && selectedOptions.length === 0}
                    onClick={() => handleResponse(true)}
                  >
                    {isDeleteOperation(request)
                      ? getDisplayFilePaths(request).length > 1
                        ? 'Delete All'
                        : 'Delete'
                      : request.type === 'question'
                        ? 'Submit'
                        : 'Allow'}
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
