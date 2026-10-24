import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * Last line of defence for the whole ERP shell. A rendering error in one screen must never
 * leave the user with a blank page: show the message, keep navigation available on reload,
 * and log the component stack for diagnostics.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Orqiva UI crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-error" role="alert">
        <div className="app-error-card">
          <div className="app-error-icon">
            <AlertTriangle size={30} />
          </div>
          <h1>حدث خطأ غير متوقع في هذه الشاشة</h1>
          <p>
            بقيت بياناتك محفوظة في الخادم. أعد تحميل الصفحة للمتابعة، وإذا تكرر الخطأ فأبلغ مدير
            النظام بالتفاصيل التالية.
          </p>
          <code dir="ltr">{this.state.error.message}</code>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            <RotateCcw size={17} /> إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    );
  }
}
