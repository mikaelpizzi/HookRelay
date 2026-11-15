'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  code: string | Record<string, any>;
  language?: string;
  maxHeight?: string;
  className?: string;
}

export function CodeBlock({
  code,
  language = 'json',
  maxHeight = '300px',
  className = '',
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const formattedCode =
    typeof code === 'string'
      ? code
      : JSON.stringify(code, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied
    }
  };

  return (
    <div
      className={`relative rounded border border-zinc-800 bg-[#0c0c0e] font-mono text-xs ${className}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-zinc-500 text-[10px] uppercase tracking-wider">
        <span>{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre
        className="p-3 overflow-auto text-zinc-300 font-mono text-[11px] leading-relaxed selection:bg-zinc-800"
        style={{ maxHeight }}
      >
        <code>{formattedCode}</code>
      </pre>
    </div>
  );
}
