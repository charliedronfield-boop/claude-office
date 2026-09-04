"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Search } from "lucide-react";
import Modal from "./Modal";
import { useTranslation } from "@/hooks/useTranslation";
import { apiFetch } from "@/utils/api";

interface SearchResult {
  sessionId: string;
  sessionLabel: string | null;
  eventType: string;
  timestamp: string;
  snippet: string;
}

const DEBOUNCE_MS = 300;

export interface SearchHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect: (sessionId: string) => Promise<void>;
}

export function SearchHistoryModal({
  isOpen,
  onClose,
  onSessionSelect,
}: SearchHistoryModalProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("search.title")}>
      {/* Mounted only while open, so its search state resets for free on
          every open — no reset-on-close effect needed. */}
      {isOpen && (
        <SearchHistoryModalBody onClose={onClose} onSessionSelect={onSessionSelect} />
      )}
    </Modal>
  );
}

interface SearchHistoryModalBodyProps {
  onClose: () => void;
  onSessionSelect: (sessionId: string) => Promise<void>;
}

function SearchHistoryModalBody({
  onClose,
  onSessionSelect,
}: SearchHistoryModalBodyProps): ReactNode {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const trimmedQuery = query.trim();

  useEffect(() => {
    let cancelled = false;

    async function runSearch(): Promise<void> {
      if (!trimmedQuery) return;
      setLoading(true);
      setError(false);
      try {
        const res = await apiFetch(
          `/api/v1/sessions/search?q=${encodeURIComponent(trimmedQuery)}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as SearchResult[];
        if (!cancelled) setResults(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const timer = setTimeout(() => void runSearch(), DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const handleSelect = async (result: SearchResult) => {
    await onSessionSelect(result.sessionId);
    onClose();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg">
        <Search size={14} className="text-slate-500 flex-shrink-0" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="flex-1 bg-transparent text-white text-sm font-mono outline-none placeholder-slate-600"
        />
      </div>

      <div className="max-h-96 overflow-y-auto space-y-1 font-mono text-xs">
        {!trimmedQuery && (
          <div className="text-slate-700 text-center py-6">{t("search.emptyHint")}</div>
        )}
        {trimmedQuery && loading && (
          <div className="text-slate-600 text-center py-6">{t("search.searching")}</div>
        )}
        {trimmedQuery && !loading && error && (
          <div className="text-rose-400 text-center py-6">{t("search.error")}</div>
        )}
        {trimmedQuery && !loading && !error && results.length === 0 && (
          <div className="text-slate-600 text-center py-6">{t("search.noResults")}</div>
        )}
        {trimmedQuery &&
          !loading &&
          !error &&
          results.map((result, i) => (
            <button
              key={`${result.sessionId}-${result.timestamp}-${i}`}
              type="button"
              onClick={() => void handleSelect(result)}
              className="w-full text-left px-3 py-2 rounded border border-transparent hover:border-slate-700 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-blue-400 font-bold truncate">
                  {result.sessionLabel ?? result.sessionId}
                </span>
                <span className="text-slate-600 flex-shrink-0">
                  {format(new Date(result.timestamp), "MMM d, HH:mm:ss")}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-500 mt-0.5">
                <span className="uppercase text-[10px] tracking-wider text-slate-600">
                  {result.eventType}
                </span>
                {result.snippet && (
                  <span className="truncate text-slate-400">{result.snippet}</span>
                )}
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
