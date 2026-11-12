import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';

/** Quét mã vạch bằng camera (Chrome Android / Edge: BarcodeDetector API – miễn phí, không cần thư viện) */
export default function CameraScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: any;
    let stopped = false;
    (async () => {
      if (!window.isSecureContext) {
        setErr(`Trình duyệt chỉ cho dùng camera trên kết nối an toàn. Trên Chrome Android: mở chrome://flags → "Insecure origins treated as secure" → thêm ${location.origin} → Enabled → khởi động lại Chrome.`);
        return;
      }
      const BD = (window as any).BarcodeDetector;
      if (!BD) { setErr('Trình duyệt này chưa hỗ trợ quét mã bằng camera. Hãy dùng Chrome trên Android, hoặc dùng máy quét mã vạch.'); return; }
      try {
        const supported: string[] = await BD.getSupportedFormats();
        const want = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'].filter((f) => supported.includes(f));
        const detector = new BD({ formats: want });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (stopped) return;
        video.current!.srcObject = stream;
        await video.current!.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video.current!);
            if (codes.length && codes[0].rawValue) {
              navigator.vibrate?.(80);
              stopped = true;
              onResult(codes[0].rawValue);
              return;
            }
          } catch { /* khung hình chưa sẵn sàng */ }
          timer = setTimeout(tick, 150);
        };
        tick();
      } catch (e: any) {
        setErr(e?.name === 'NotAllowedError' ? 'Bạn chưa cho phép truy cập camera.' : 'Không mở được camera: ' + (e?.message ?? e));
      }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onResult]);
  return (
    <Modal open size="sm" title="Quét mã vạch bằng camera" onClose={onClose}>
      {err ? <div className="text-sm text-red-700 bg-red-50 rounded-xl p-4">{err}</div> : (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4]">
          <video ref={video} playsInline muted className="w-full h-full object-cover" />
          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-24 border-2 border-gold-300 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          <div className="absolute bottom-3 inset-x-0 text-center text-xs text-white">Đưa mã vạch vào khung</div>
        </div>
      )}
    </Modal>
  );
}
