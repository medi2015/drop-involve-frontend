import React from 'react';
import { STORAGE_KEYS } from '../lib/storage';

/**
 * Last line of defence. Without this, any error thrown during render unmounts
 * the whole React tree and leaves an empty window with no way out.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => {
    Object.values(STORAGE_KEYS).forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing useful to do; the reload below is still worth attempting.
      }
    });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
        <div className="w-full max-w-md rounded-2xl bg-slate-800 p-8 shadow-xl">
          <h1 className="mb-2 text-xl font-semibold">Noe gikk galt</h1>
          <p className="mb-6 text-sm text-slate-400">
            Appen klarte ikke å starte. Du kan tilbakestille lokal historikk og
            prøve på nytt &mdash; filene dine i skyen blir ikke berørt.
          </p>

          <button
            onClick={this.handleReset}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-500"
          >
            Tilbakestill og start på nytt
          </button>

          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
              Tekniske detaljer
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-3 text-xs text-slate-400">
              {String(error?.stack || error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
