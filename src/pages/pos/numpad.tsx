import { Delete, X } from 'lucide-react';

/**
 * On-screen numeric keypad for touch tills without a physical keyboard.
 *
 * It is a controlled "append/backspace" surface: the parent owns the string value and the
 * keypad only reports edits, so it works equally for the amount tendered and cart quantities.
 */
export function NumberPad({
  value,
  onChange,
  onSubmit,
  onClose,
  title = 'لوحة الأرقام',
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Fired by the big confirm key (↵). Optional — omit for inline editors. */
  onSubmit?: () => void;
  onClose: () => void;
  title?: string;
  hint?: string;
}) {
  const press = (key: string) => {
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.') {
      if (value.includes('.')) return;
      onChange((value || '0') + '.');
      return;
    }
    // Avoid leading-zero clutter like "007" while still allowing a bare "0".
    onChange(value === '0' ? key : value + key);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', 'del'];

  return (
    <div className="pos-numpad">
      <div className="pos-numpad-head">
        <span>{title}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="إغلاق لوحة الأرقام"
        >
          <X size={16} />
        </button>
      </div>
      {hint && <div className="pos-numpad-hint">{hint}</div>}
      <div className="pos-numpad-grid">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className="pos-numpad-key"
            onClick={() => press(k)}
            aria-label={k === 'del' ? 'حذف' : k}
          >
            {k === 'del' ? <Delete size={20} /> : k}
          </button>
        ))}
      </div>
      {onSubmit && (
        <button type="button" className="pos-numpad-enter" onClick={onSubmit}>
          تأكيد
        </button>
      )}
    </div>
  );
}
