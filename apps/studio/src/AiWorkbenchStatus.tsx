import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type AiWorkbenchNoticeTone = "info" | "success" | "error";

export type AiWorkbenchNotice = {
  id: number;
  message: string;
  tone: AiWorkbenchNoticeTone;
};

type AiWorkbenchStatusContextValue = {
  notice: AiWorkbenchNotice | null;
  publish: (message: string, tone?: AiWorkbenchNoticeTone) => void;
  clear: () => void;
};

const AiWorkbenchStatusContext = createContext<AiWorkbenchStatusContextValue | null>(null);

export function AiWorkbenchStatusProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<AiWorkbenchNotice | null>(null);
  const publish = useCallback((message: string, tone: AiWorkbenchNoticeTone = "info") => {
    const nextMessage = String(message || "").trim();
    if (!nextMessage) return;
    setNotice({ id: Date.now(), message: nextMessage, tone });
  }, []);
  const clear = useCallback(() => setNotice(null), []);
  const value = useMemo(() => ({ notice, publish, clear }), [notice, publish, clear]);

  return <AiWorkbenchStatusContext.Provider value={value}>{children}</AiWorkbenchStatusContext.Provider>;
}

export function useAiWorkbenchStatus() {
  return useContext(AiWorkbenchStatusContext);
}

export function useAiWorkbenchNotice() {
  const context = useAiWorkbenchStatus();
  return context?.publish ?? (() => undefined);
}
