import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import { openExternal } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { ConnectedProvider, CopilotCredentials } from '@/shared';
import { PROVIDER_META } from '@/shared';
import githubCopilotLogo from '/assets/ai-logos/github-copilot.svg';
import { ConnectedControls, FormError, ModelSelector, ProviderFormHeader } from '../shared';

type AuthState = 'disconnected' | 'authorizing' | 'connected';

interface OAuthResult {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
}

interface CopilotProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function CopilotProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: CopilotProviderFormProps) {
  const [enterpriseUrl, setEnterpriseUrl] = useState('');
  const [authState, setAuthState] = useState<AuthState>(connectedProvider?.connectionStatus === 'connected' ? 'connected' : 'disconnected');
  const [oauthResult, setOauthResult] = useState<OAuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>(connectedProvider?.availableModels ?? []);
  const [codeCopied, setCodeCopied] = useState(false);

  const unlistenersRef = useRef<Array<() => void>>([]);

  const meta = PROVIDER_META['github-copilot'];
  const isConnected = connectedProvider?.connectionStatus === 'connected';

  useEffect(() => {
    if (isConnected) {
      setAuthState('connected');
      if (connectedProvider?.availableModels?.length) {
        setAvailableModels(connectedProvider.availableModels);
      }
    }
  }, [isConnected, connectedProvider?.availableModels]);

  const cleanupListeners = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  useEffect(() => {
    return cleanupListeners;
  }, [cleanupListeners]);

  const handleSignIn = async () => {
    setError(null);
    setAuthState('authorizing');

    try {
      const api = getTauriAPI();

      const unlistenResult = api.onCopilotOAuthResult((result: { url: string; method: string; instructions: string }) => {
        setOauthResult({
          url: result.url,
          method: result.method as 'auto' | 'code',
          instructions: result.instructions,
        });
        openExternal(result.url);
      });
      unlistenersRef.current.push(unlistenResult);

      const unlistenComplete = api.onCopilotOAuthComplete((result: { connected: boolean; error?: string }) => {
        if (result.connected) {
          api.copilotGetModels();
        } else {
          setAuthState('disconnected');
          if (result.error) {
            setError(result.error === 'timed out' ? 'Authorization timed out. Please try again.' : result.error);
          }
          cleanupListeners();
        }
      });
      unlistenersRef.current.push(unlistenComplete);

      const unlistenModels = api.onCopilotModelsResult(
        (result: { success: boolean; models?: Array<{ id: string; name: string }>; error?: string }) => {
          if (result.success && result.models) {
            setAvailableModels(result.models);
            setAuthState('connected');

            const credentials: CopilotCredentials = {
              type: 'copilot',
              enterpriseUrl: enterpriseUrl.trim() || undefined,
            };

            onConnect({
              providerId: 'github-copilot',
              connectionStatus: 'connected',
              selectedModelId: result.models.length === 1 ? result.models[0].id : null,
              credentials,
              lastConnectedAt: new Date().toISOString(),
              availableModels: result.models,
            });
          } else {
            setError(result.error ?? 'Failed to fetch models');
            setAuthState('disconnected');
          }
          cleanupListeners();
        }
      );
      unlistenersRef.current.push(unlistenModels);

      await api.copilotOAuthAuthorize(enterpriseUrl.trim() || undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setAuthState('disconnected');
      cleanupListeners();
    }
  };

  const handleCancel = () => {
    setAuthState('disconnected');
    setOauthResult(null);
    cleanupListeners();
  };

  const handleDisconnect = async () => {
    try {
      const api = getTauriAPI();
      await api.copilotDisconnect();
      setAuthState('disconnected');
      setAvailableModels([]);
      setOauthResult(null);
      onDisconnect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const handleCopyCode = async () => {
    if (!oauthResult) return;
    const code = oauthResult.instructions;
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback: ignore clipboard errors
    }
  };

  return (
    <div>
      <ProviderFormHeader logoSrc={githubCopilotLogo} providerName={meta.name} />

      <AnimatePresence mode="wait">
        {authState === 'disconnected' && (
          <motion.div
            animate="animate"
            exit="exit"
            initial="initial"
            key="disconnected"
            transition={settingsTransitions.enter}
            variants={settingsVariants.slideDown}
          >
            <p className="mb-4 text-muted-foreground text-sm">
              Sign in with your GitHub account to use models available through your Copilot subscription.
            </p>

            <div className="mb-4">
              <label className="mb-2 block font-medium text-foreground text-sm" htmlFor="copilot-enterprise-url">
                Enterprise URL <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground"
                id="copilot-enterprise-url"
                onChange={(e) => setEnterpriseUrl(e.target.value)}
                placeholder="https://github.example.com"
                type="url"
                value={enterpriseUrl}
              />
              <p className="mt-1 text-muted-foreground text-xs">Only needed for GitHub Enterprise deployments.</p>
            </div>

            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#24292f] px-4 py-2.5 font-medium text-sm text-white transition-colors hover:bg-[#32383f] dark:bg-[#f0f0f0] dark:text-[#24292f] dark:hover:bg-[#e0e0e0]"
              data-testid="copilot-sign-in-button"
              onClick={handleSignIn}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Sign in with GitHub
            </button>

            {error && <FormError error={error} />}
          </motion.div>
        )}

        {authState === 'authorizing' && (
          <motion.div
            animate="animate"
            exit="exit"
            initial="initial"
            key="authorizing"
            transition={settingsTransitions.enter}
            variants={settingsVariants.slideDown}
          >
            {oauthResult ? (
              <div className="space-y-4">
                <p className="text-foreground text-sm">{oauthResult.instructions}</p>

                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-input bg-muted px-4 py-3 text-center font-mono text-lg tracking-widest">
                    {oauthResult.instructions.replace('Enter code: ', '')}
                  </code>
                  <button
                    className="rounded-md border border-input bg-background px-3 py-3 text-sm transition-colors hover:bg-muted"
                    onClick={handleCopyCode}
                    title="Copy code"
                  >
                    {codeCopied ? (
                      <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                        />
                      </svg>
                    )}
                  </button>
                </div>

                <button
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-muted"
                  onClick={() => openExternal(oauthResult.url)}
                >
                  Open github.com/login/device
                </button>

                <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                  </svg>
                  Waiting for authorization...
                </div>

                <button
                  className="w-full rounded-lg border border-border px-4 py-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
                  onClick={handleCancel}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                </svg>
                Starting OpenCode server...
              </div>
            )}

            {error && <FormError error={error} />}
          </motion.div>
        )}

        {authState === 'connected' && (
          <motion.div
            animate="animate"
            exit="exit"
            initial="initial"
            key="connected"
            transition={settingsTransitions.enter}
            variants={settingsVariants.slideDown}
          >
            <div className="space-y-4">
              <ConnectedControls onDisconnect={handleDisconnect} />

              <ModelSelector
                error={showModelError}
                models={availableModels}
                onChange={onModelChange}
                placeholder="Select a Copilot model..."
                value={connectedProvider?.selectedModelId ?? null}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
