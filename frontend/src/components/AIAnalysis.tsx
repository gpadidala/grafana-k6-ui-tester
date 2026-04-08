import React, { useState } from 'react';
import Card from './Card';
import { TestRun } from '../types';
import { analyzeWithLLM, getLLMConfig } from '../api/llm';

interface Props {
  run: TestRun;
}

export default function AIAnalysis({ run }: Props) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = getLLMConfig();

  const hasFailures = (run.results || []).some(r => r.status === 'FAIL' || r.status === 'WARN');
  const isConfigured = config.provider !== 'none' && config.apiKey;

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const result = await analyzeWithLLM(run);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!hasFailures) return null;

  return (
    <Card className="border-purple-800/50 bg-gradient-to-br from-surface-100 to-purple-950/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="font-semibold text-white">AI Failure Analysis</h3>
          {config.provider !== 'none' && (
            <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded-full">
              {config.provider === 'openai' ? 'OpenAI' : 'Claude'} — {config.model || 'default'}
            </span>
          )}
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading || !isConfigured}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            loading
              ? 'bg-surface-300 text-muted cursor-not-allowed'
              : isConfigured
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-surface-300 text-muted cursor-not-allowed'
          }`}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-purple-300/30 border-t-purple-300 rounded-full animate-spin" />
              Analyzing...
            </span>
          ) : (
            'Analyze Failures'
          )}
        </button>
      </div>

      {!isConfigured && (
        <p className="text-sm text-muted">
          Configure an LLM provider in the <strong className="text-purple-300">Environments</strong> page to enable AI analysis.
          Supports <strong>OpenAI</strong> (GPT-4o) and <strong>Claude</strong> (Sonnet/Opus).
        </p>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {analysis && (
        <div className="mt-4 p-4 bg-surface-200 rounded-lg border border-surface-300 overflow-auto max-h-[600px]">
          <div className="prose prose-invert prose-sm max-w-none">
            {analysis.split('\n').map((line, i) => {
              if (line.startsWith('## ')) {
                return <h2 key={i} className="text-lg font-bold text-white mt-4 mb-2 border-b border-surface-300 pb-1">{line.replace('## ', '')}</h2>;
              }
              if (line.startsWith('### ')) {
                return <h3 key={i} className="text-sm font-semibold text-purple-300 mt-3 mb-1">{line.replace('### ', '')}</h3>;
              }
              if (line.startsWith('- **Root Cause:**')) {
                return <p key={i} className="text-sm ml-4 mb-0.5"><span className="text-red-400 font-medium">Root Cause:</span> {line.replace('- **Root Cause:** ', '')}</p>;
              }
              if (line.startsWith('- **Fix:**')) {
                return <p key={i} className="text-sm ml-4 mb-0.5"><span className="text-green-400 font-medium">Fix:</span> {line.replace('- **Fix:** ', '')}</p>;
              }
              if (line.startsWith('- **Severity:**')) {
                const sev = line.replace('- **Severity:** ', '').trim();
                const sevColor = sev.includes('Critical') ? 'text-red-400' : sev.includes('High') ? 'text-orange-400' : sev.includes('Medium') ? 'text-yellow-400' : 'text-muted';
                return <p key={i} className="text-sm ml-4 mb-2"><span className={`font-medium ${sevColor}`}>Severity: {sev}</span></p>;
              }
              if (line.startsWith('- ')) {
                return <p key={i} className="text-sm text-gray-300 ml-4 mb-0.5">• {line.slice(2)}</p>;
              }
              if (line.trim() === '') return <br key={i} />;
              return <p key={i} className="text-sm text-gray-300 mb-1">{line}</p>;
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
