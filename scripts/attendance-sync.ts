/**
 * Orqiva Biometric Attendance Device Sync Tool
 * أداة مزامنة أجهزة البصمة مع نظام أوركيفا
 *
 * Usage / الاستخدام:
 *   npx tsx scripts/attendance-sync.ts --help
 *   npx tsx scripts/attendance-sync.ts --test --ip=192.168.1.201 --port=4370
 *   npx tsx scripts/attendance-sync.ts --file=attlog.dat --key=orq_dev_... --url=http://localhost:3000
 *   npx tsx scripts/attendance-sync.ts --file=attlog.dat --sn=ZK-001 --url=http://localhost:3000
 */

import * as fs from 'node:fs';
import * as net from 'node:net';

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        args[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        args[arg.slice(2)] = true;
      }
    }
  }
  return args;
}

async function testTcp(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`📡 جاري اختبار الاتصال بجهاز البصمة على العنوان ${ip}:${port}...`);
    const socket = new net.Socket();
    socket.setTimeout(4000);
    socket.on('connect', () => {
      console.log(`✅ تم الاتصال بنجاح بجهاز البصمة على المنفذ ${port}`);
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      console.error(`❌ مهلة الاتصال انتهت (Timeout) مع ${ip}:${port}`);
      socket.destroy();
      resolve(false);
    });
    socket.on('error', (err) => {
      console.error(`❌ تعذر الاتصال بالجهاز: ${err.message}`);
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

async function uploadFile(filePath: string, serverUrl: string, apiKey?: string, sn?: string) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ الملف غير موجود: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  console.log(`📄 قراءة الملف (${content.split(/\r?\n/).filter(Boolean).length} سطر)...`);

  const baseUrl = serverUrl.replace(/\/+$/, '');

  if (apiKey) {
    console.log(`🚀 إرسال البصمات عبر API Key إلى ${baseUrl}/api/attendance-devices/ingest...`);
    const res = await fetch(`${baseUrl}/api/attendance-devices/ingest/csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Device-Key': apiKey,
      },
      body: content,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.error(`❌ فشل الإرسال (${res.status}):`, json);
      process.exit(1);
    }
    console.log('✅ تم استيراد البصمات بنجاح:', json);
  } else if (sn) {
    console.log(`🚀 إرسال البصمات عبر بروتوكول ADMS إلى ${baseUrl}/iclock/cdata?SN=${sn}...`);
    const res = await fetch(`${baseUrl}/iclock/cdata?SN=${sn}&table=ATTLOG`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    });
    const text = await res.text();
    if (!res.ok || text.startsWith('ERROR')) {
      console.error(`❌ رد الخادم بخطأ: ${text}`);
      process.exit(1);
    }
    console.log(`✅ استجابة خادم ADMS: ${text}`);
  } else {
    console.error('❌ يرجى تحديد إما --key=<مفتاح_الجهاز> أو --sn=<الرقم_التسلسلي>');
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs();

  if (args.help || Object.keys(args).length === 0) {
    console.log(`
══════════════════════════════════════════════════════════════
  أداة مزامنة وربط أجهزة البصمة — Orqiva Attendance Sync Tool
══════════════════════════════════════════════════════════════

الخيارات المتاحة:
  --help               عرض هذه المساعدة
  --test               اختبار الاتصال بجهاز البصمة عبر الشبكة (TCP Port 4370)
  --ip=<IP>            عنوان IP الخاص بجهاز البصمة (الافتراضي: 192.168.1.201)
  --port=<PORT>        منفذ جهاز البصمة (الافتراضي: 4370)
  --file=<PATH>        مسار ملف البصمات المستخرج من الفلاشة (attlog.dat أو csv)
  --url=<URL>          رابط سيرفر أوركيفا (الافتراضي: http://localhost:3000)
  --key=<API_KEY>      مفتاح API الخاص بجهاز البصمة (orq_dev_...)
  --sn=<SERIAL>        الرقم التسلسلي لجهاز البصمة (ZK-...)

أمثلة:
  1. اختبار الوصول لجهاز البصمة على الشبكة المحلية:
     npx tsx scripts/attendance-sync.ts --test --ip=192.168.1.201

  2. رفع ملف بصمات مستخرج من فلاشة USB عبر مفتاح الجهاز:
     npx tsx scripts/attendance-sync.ts --file=attlog.dat --key=orq_dev_xxxx

  3. رفع ملف بصمات عبر الرقم التسلسلي لجهاز ADMS:
     npx tsx scripts/attendance-sync.ts --file=attlog.dat --sn=ZK-MAIN-01 --url=http://localhost:3000
══════════════════════════════════════════════════════════════
    `);
    return;
  }

  const ip = String(args.ip || '192.168.1.201');
  const port = Number(args.port || 4370);
  const serverUrl = String(args.url || 'http://localhost:3000');

  if (args.test) {
    const ok = await testTcp(ip, port);
    process.exit(ok ? 0 : 1);
  }

  if (args.file) {
    const file = String(args.file);
    const key = args.key ? String(args.key) : undefined;
    const sn = args.sn ? String(args.sn) : undefined;
    await uploadFile(file, serverUrl, key, sn);
    return;
  }

  console.log('يرجى تحديد إجراء: --test لاختبار الشبكة أو --file=<مسار> للرفع. استخدم --help للمزيد.');
}

void main();
