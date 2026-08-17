import React from 'react';
import { STORAGE_KEYS } from '../lib/storage';
import { reportError } from '../lib/reportError';

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
    reportError(error, 'react-render');
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
      <div className="flex min-h-screen items-center justify-center bg-ink p-6 text-sand">
        <div className="w-full max-w-md rounded-2xl surface p-8">
          <h1 className="mb-2 text-lg font-medium">Noe gikk galt</h1>
          <p className="mb-6 text-sm text-sand/60">
            Appen klarte ikke å starte. Du kan tilbakestille lokal historikk og
            prøve på nytt &mdash; filene dine i skyen blir ikke berørt.
          </p>

          <button
            onClick={this.handleReset}
            className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-ink-deep transition-colors hover:bg-brand/90"
          >
            Tilbakestill og start på nytt
          </button>

          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-sand/50 hover:text-sand/80">
              Tekniske detaljer
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded surface-inset p-3 text-xs text-sand/60">
              {String(error?.stack || error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
