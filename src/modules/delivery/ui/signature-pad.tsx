"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";

// Signature of the recipient (D-007), drawn with the finger. Produces a PNG
// on a white background. No animation (agents.md §8).

const WIDTH = 600;
const HEIGHT = 220;

export function SignaturePad({ onChange }: { onChange: (png: Blob | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    resetCanvas(canvasRef.current);
  }, []);

  function context(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function clearCanvas() {
    resetCanvas(canvasRef.current);
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    if (!drawingRef.current || !ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setHasInk(true);
    canvasRef.current?.toBlob((blob) => onChange(blob), "image/png");
  }

  function clear() {
    clearCanvas();
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Espacio para la firma de quien recibe"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="w-full touch-none rounded-[4px] border border-gold bg-white"
      />
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{hasInk ? "Firma capturada." : "Firma aquí con el dedo."}</span>
        {/* UI helper, not an action: it only clears the drawing. */}
        <button type="button" onClick={clear} className="link min-h-10 px-2">
          Borrar firma
        </button>
      </div>
    </div>
  );
}

/** White background and pen settings. */
function resetCanvas(canvas: HTMLCanvasElement | null) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111111";
}
