import React, { useRef, useState } from 'react';
import { Camera, Crop, Image as ImageIcon, Link2, Trash2, Upload } from 'lucide-react';
import { optimizeProductImage } from '../lib/imageOptimizer.js';

export default function ImagePickerField({
  value = '',
  onChange,
  label = 'Foto del producto (para POS y Catálogo)',
  compact = false,
}) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const [cropSquare, setCropSquare] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [meta, setMeta] = useState(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [err, setErr] = useState('');

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setProcessing(true);
    try {
      const optimized = await optimizeProductImage(file, {
        maxDimension: 800,
        cropSquare,
        maxBytes: 115 * 1024,
      });
      setMeta(optimized);
      onChange?.(optimized.dataUrl);
    } catch (error) {
      setErr(error.message || 'No se pudo procesar la imagen.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-bold text-[#181715]">{label}</label>
        <button
          type="button"
          onClick={() => setCropSquare((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6E685F] hover:text-[#181715] cursor-pointer"
          title="Cambiar entre recorte cuadrado 1:1 o proporción original (máx. 800×800 px)"
        >
          <Crop className="h-3 w-3" />
          {cropSquare ? 'Recorte 1:1 (800×800)' : 'Original (máx. 800px)'}
        </button>
      </div>

      <div className="rounded-2xl border border-[#E2DCD0] bg-[#FAF8F4] p-3 flex items-center gap-3.5">
        {/* Thumbnail */}
        <div
          className={`${
            compact ? 'h-16 w-16' : 'h-20 w-20'
          } shrink-0 rounded-xl border border-[#DDD6C8] bg-white overflow-hidden flex items-center justify-center`}
        >
          {value ? (
            <img src={value} alt="Vista previa" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-[#B5AEA2]" />
          )}
        </div>

        {/* Upload / Camera / URL actions */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={processing}
              onClick={() => fileRef.current?.click()}
              className="btn-secondary rounded-full text-xs py-1.5 px-3 bg-white"
            >
              <Upload className="h-3.5 w-3.5" />
              {processing ? 'Optimizando...' : 'Subir foto'}
            </button>
            <button
              type="button"
              disabled={processing}
              onClick={() => cameraRef.current?.click()}
              className="btn-secondary rounded-full text-xs py-1.5 px-3 bg-white"
            >
              <Camera className="h-3.5 w-3.5 text-[#15614B]" />
              Cámara
            </button>
            <button
              type="button"
              onClick={() => setShowUrlInput((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[#6E685F] hover:text-[#181715] hover:bg-white cursor-pointer"
            >
              <Link2 className="h-3.5 w-3.5" />
              URL
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  setMeta(null);
                  onChange?.('');
                }}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] text-[#9E2A2B] hover:bg-[#FBEAEA] cursor-pointer"
                title="Quitar foto"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {meta ? (
            <p className="text-[11px] font-medium text-[#15614B]">
              ✓ Optimizada: {meta.width}×{meta.height} px · {meta.format} · {meta.sizeKb} KB
              {meta.originalKb > meta.sizeKb ? ` (de ${meta.originalKb} KB)` : ''} — carga rápida en datos móviles
            </p>
          ) : (
            <p className="text-[11px] text-[#7A7368]">
              Se comprime automáticamente a WebP/JPEG (máx. 800×800 px) para abrir rápido en datos móviles.
            </p>
          )}

          {err && <p className="text-[11px] font-semibold text-[#9E2A2B]">{err}</p>}
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          className="hidden"
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelected}
          className="hidden"
        />
      </div>

      {showUrlInput && (
        <input
          type="url"
          className="input-field bg-white text-xs"
          placeholder="O pega un enlace externo de imagen (https://...)"
          value={value.startsWith('data:') ? '' : value}
          onChange={(e) => {
            setMeta(null);
            onChange?.(e.target.value);
          }}
        />
      )}
    </div>
  );
}
