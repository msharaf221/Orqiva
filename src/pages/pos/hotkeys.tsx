import { Button, Modal } from '../../lib';

export function HotkeysModal({ onClose }: { onClose: () => void }) {
  const hotkeys = [
    { key: 'F2 / مسافة', desc: 'فتح نافذة الدفع الفوري وإنهاء الطلب' },
    { key: 'F3', desc: 'الانتقال السريع لحقل البحث والباركود' },
    { key: 'F4', desc: 'فتح قائمة اختيار العميل أو العميل الطائر' },
    { key: 'F8', desc: 'تسجيل حركة نقدية في الدرج (إيداع/سحب)' },
    { key: 'F9', desc: 'إغلاق الوردية ومطابقة النقدية' },
    { key: 'Escape', desc: 'إغلاق أي نافذة منبثقة مفتوحة' },
    { key: 'ماسح الباركود', desc: 'مسح أي منتج لإضافته للسلة فوراً دون استخدام الفأرة' },
  ];

  return (
    <Modal title="اختصارات لوحة المفاتيح لنقطة البيع" onClose={onClose}>
      <div className="modal-body">
        <div className="pos-hotkeys-list">
          {hotkeys.map((h) => (
            <div className="pos-hotkey-row" key={h.key}>
              <kbd className="pos-kbd">{h.key}</kbd>
              <span>{h.desc}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}
